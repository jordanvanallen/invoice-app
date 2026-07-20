use serde::Deserialize;
use serde_json::Value;
use sqlx::{Pool, Sqlite};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlStatement {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
    expected_rows_affected: Option<u64>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlStatementResult {
    rows_affected: u64,
    last_insert_id: i64,
}

/// Execute every supplied statement on one SQLite transaction/connection.
async fn execute_statements(
    pool: &Pool<Sqlite>,
    statements: Vec<SqlStatement>,
) -> Result<Vec<SqlStatementResult>, String> {
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    let mut results = Vec::with_capacity(statements.len());
    for statement in statements {
        let mut query = sqlx::query(&statement.sql);
        for value in statement.params {
            query = match value {
                Value::Null => query.bind(Option::<String>::None),
                Value::Bool(value) => query.bind(value),
                Value::Number(value) if value.is_i64() => {
                    query.bind(value.as_i64().expect("checked i64"))
                }
                Value::Number(value) if value.is_u64() => {
                    let integer = i64::try_from(value.as_u64().expect("checked u64"))
                        .map_err(|_| "SQLite integer parameter is out of range.".to_string())?;
                    query.bind(integer)
                }
                Value::Number(value) => query.bind(
                    value
                        .as_f64()
                        .ok_or_else(|| "Invalid numeric SQL parameter.".to_string())?,
                ),
                Value::String(value) => query.bind(value),
                Value::Array(_) | Value::Object(_) => {
                    return Err("SQL parameters must be scalar values.".to_string());
                }
            };
        }
        let result = query
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
        let rows_affected = result.rows_affected();
        if let Some(expected_rows_affected) = statement.expected_rows_affected {
            if rows_affected != expected_rows_affected {
                return Err(format!(
                    "Expected {expected_rows_affected} row(s) affected; affected {rows_affected}."
                ));
            }
        }
        results.push(SqlStatementResult {
            rows_affected,
            last_insert_id: result.last_insert_rowid(),
        });
    }
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;
    Ok(results)
}

/// Execute every supplied statement on one SQLite transaction/connection.
#[tauri::command]
pub async fn execute_sqlite_transaction(
    db_instances: State<'_, DbInstances>,
    db: String,
    statements: Vec<SqlStatement>,
) -> Result<Vec<SqlStatementResult>, String> {
    let instances = db_instances.0.read().await;
    let Some(DbPool::Sqlite(pool)) = instances.get(&db) else {
        return Err(format!("SQLite database {db} is not loaded."));
    };
    execute_statements(pool, statements).await
}

#[cfg(test)]
mod tests {
    use super::{execute_statements, SqlStatement};
    use serde_json::json;
    use sqlx::{Row, SqlitePool};

    async fn create_v4_line_items(pool: &SqlitePool) {
        sqlx::query(
            "CREATE TABLE invoices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                year INTEGER NOT NULL
            )",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE line_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                type TEXT NOT NULL CHECK (type IN ('completed','noshow')),
                position INTEGER NOT NULL DEFAULT 0,
                inspection_number TEXT NOT NULL DEFAULT '',
                client_id INTEGER,
                client_name TEXT NOT NULL DEFAULT '',
                location_id INTEGER,
                location TEXT NOT NULL DEFAULT '',
                date TEXT NOT NULL DEFAULT '',
                vin8 TEXT NOT NULL DEFAULT '',
                mileage_cents INTEGER NOT NULL DEFAULT 0,
                fee_cents INTEGER NOT NULL DEFAULT 0
            )",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO invoices (id, year) VALUES (1, 2026)")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO line_items
                (id, invoice_id, type, position, inspection_number, client_name, location,
                 date, vin8, mileage_cents, fee_cents)
             VALUES
                (1, 1, 'completed', 3, '87654321', 'Existing Client', 'Existing Location',
                 '2026-06-30', 'ABCD1234', 1250, 3800)",
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("PRAGMA user_version = 4")
            .execute(pool)
            .await
            .unwrap();
    }

    fn v5_migration_statements() -> Vec<SqlStatement> {
        [
            "CREATE TABLE approvers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                name_key TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1
            )",
            "CREATE UNIQUE INDEX idx_approvers_name_key ON approvers(name_key)",
            "ALTER TABLE line_items ADD COLUMN mileage_approver_id INTEGER REFERENCES approvers(id)",
            "ALTER TABLE line_items ADD COLUMN mileage_approver_name TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE line_items ADD COLUMN mileage_approval_date TEXT NOT NULL DEFAULT ''",
            "PRAGMA user_version = 5",
        ]
        .into_iter()
        .map(|sql| SqlStatement {
            sql: sql.into(),
            params: vec![],
            expected_rows_affected: None,
        })
        .collect()
    }

    #[sqlx::test]
    async fn rolls_back_the_entire_batch_when_a_statement_fails(pool: SqlitePool) {
        sqlx::query("CREATE TABLE values_test (value INTEGER UNIQUE)")
            .execute(&pool)
            .await
            .unwrap();

        let result = execute_statements(
            &pool,
            vec![
                SqlStatement {
                    sql: "INSERT INTO values_test (value) VALUES (?)".into(),
                    params: vec![json!(1)],
                    expected_rows_affected: None,
                },
                SqlStatement {
                    sql: "INSERT INTO values_test (value) VALUES (?)".into(),
                    params: vec![json!(1)],
                    expected_rows_affected: None,
                },
            ],
        )
        .await;

        assert!(result.is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM values_test")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }

    #[sqlx::test]
    async fn rolls_back_when_a_statement_affects_an_unexpected_number_of_rows(pool: SqlitePool) {
        sqlx::query("CREATE TABLE values_test (id INTEGER PRIMARY KEY, value INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO values_test (id, value) VALUES (1, 10)")
            .execute(&pool)
            .await
            .unwrap();

        let result = execute_statements(
            &pool,
            vec![
                SqlStatement {
                    sql: "UPDATE values_test SET value = 20 WHERE id = 1".into(),
                    params: vec![],
                    expected_rows_affected: Some(1),
                },
                SqlStatement {
                    sql: "UPDATE values_test SET value = 30 WHERE id = 99".into(),
                    params: vec![],
                    expected_rows_affected: Some(1),
                },
            ],
        )
        .await;

        assert!(result
            .unwrap_err()
            .to_lowercase()
            .contains("expected 1 row(s) affected; affected 0"));
        let value: i64 = sqlx::query_scalar("SELECT value FROM values_test WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(value, 10);
    }

    #[sqlx::test]
    async fn returns_a_structured_result_for_each_successful_statement(pool: SqlitePool) {
        sqlx::query("CREATE TABLE values_test (id INTEGER PRIMARY KEY, value INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO values_test (id, value) VALUES (1, 10), (2, 20)")
            .execute(&pool)
            .await
            .unwrap();

        let results = execute_statements(
            &pool,
            vec![
                SqlStatement {
                    sql: "UPDATE values_test SET value = 11 WHERE id = 1".into(),
                    params: vec![],
                    expected_rows_affected: Some(1),
                },
                SqlStatement {
                    sql: "UPDATE values_test SET value = 21 WHERE id = 2".into(),
                    params: vec![],
                    expected_rows_affected: Some(1),
                },
            ],
        )
        .await
        .unwrap();

        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|result| result.rows_affected == 1));
    }

    #[sqlx::test]
    async fn migrates_a_version_4_database_to_version_5(pool: SqlitePool) {
        create_v4_line_items(&pool).await;

        execute_statements(&pool, v5_migration_statements())
            .await
            .unwrap();

        let approver_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('approvers') ORDER BY cid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(approver_columns, ["id", "name", "name_key", "active"]);

        let line_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('line_items') ORDER BY cid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(line_columns.ends_with(&[
            "mileage_approver_id".into(),
            "mileage_approver_name".into(),
            "mileage_approval_date".into(),
        ]));

        let existing_line: (i64, i64, String, i64, i64, Option<i64>, String, String) =
            sqlx::query_as(
                "SELECT invoice_id, position, inspection_number, mileage_cents, fee_cents,
                        mileage_approver_id, mileage_approver_name, mileage_approval_date
                   FROM line_items WHERE id = 1",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            existing_line,
            (
                1,
                3,
                "87654321".into(),
                1250,
                3800,
                None,
                "".into(),
                "".into()
            )
        );

        let foreign_keys = sqlx::query("PRAGMA foreign_key_list(line_items)")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(foreign_keys.iter().any(|foreign_key| {
            foreign_key.get::<String, _>("table") == "approvers"
                && foreign_key.get::<String, _>("from") == "mileage_approver_id"
                && foreign_key.get::<String, _>("to") == "id"
        }));

        let unique: i64 = sqlx::query_scalar(
            "SELECT \"unique\" FROM pragma_index_list('approvers')
             WHERE name = 'idx_approvers_name_key'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(unique, 1);
        let index_columns: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM pragma_index_info('idx_approvers_name_key') ORDER BY seqno",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(index_columns, ["name_key"]);

        sqlx::query("INSERT INTO approvers (name, name_key) VALUES ('Jane', 'jane')")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            sqlx::query("INSERT INTO approvers (name, name_key) VALUES ('Janet', 'jane')")
                .execute(&pool)
                .await
                .is_err()
        );
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(version, 5);
    }

    #[sqlx::test]
    async fn rolls_back_the_version_5_migration_when_a_statement_fails(pool: SqlitePool) {
        create_v4_line_items(&pool).await;
        let mut statements = v5_migration_statements();
        statements.push(SqlStatement {
            sql: "INSERT INTO missing_table (id) VALUES (1)".into(),
            params: vec![],
            expected_rows_affected: None,
        });

        assert!(execute_statements(&pool, statements).await.is_err());

        let approver_table_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'approvers'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(approver_table_count, 0);
        let line_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('line_items') ORDER BY cid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(!line_columns
            .iter()
            .any(|column| column.starts_with("mileage_approver")));
        assert!(!line_columns
            .iter()
            .any(|column| column == "mileage_approval_date"));
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(version, 4);
    }
}
