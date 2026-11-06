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
    use super::{execute_statements, SqlStatement, SqlStatementResult};
    use serde::Deserialize;
    use serde_json::json;
    use sqlx::{Row, SqlitePool};
    use std::time::{Duration, Instant};

    /// The app's migrations, embedded at compile time from their TypeScript
    /// source of truth so native-SQLite tests run exactly the statements that ship.
    const SCHEMA_TS: &str = include_str!("../../src/lib/db/schema.ts");

    /// Every shipped migration as `(version, statements)`, in version order.
    ///
    /// Panics, failing the calling test, if `schema.ts` no longer has the shape
    /// this reader relies on: `version: N,` followed by plain backtick SQL strings.
    fn shipped_migrations() -> Vec<(i64, Vec<String>)> {
        let (_, list) = SCHEMA_TS
            .split_once("export const MIGRATIONS")
            .expect("schema.ts exports MIGRATIONS");
        let migrations: Vec<(i64, Vec<String>)> = list
            .split("version: ")
            .skip(1)
            .map(|entry| {
                let (version, body) = entry
                    .split_once(',')
                    .expect("a migration version is followed by a comma");
                assert_eq!(body.matches('`').count() % 2, 0, "unbalanced SQL literal");
                let statements: Vec<String> = body
                    .split('`')
                    .skip(1)
                    .step_by(2)
                    .map(str::to_owned)
                    .collect();
                assert!(
                    statements
                        .iter()
                        .all(|sql| !sql.contains("${") && !sql.contains('\\')),
                    "migration SQL must be plain template literals"
                );
                let version = version.trim().parse().expect("numeric migration version");
                (version, statements)
            })
            .collect();
        let versions: Vec<i64> = migrations.iter().map(|(version, _)| *version).collect();
        let expected: Vec<i64> = (1..=versions.len() as i64).collect();
        assert_eq!(
            versions, expected,
            "migration versions are contiguous from 1"
        );
        migrations
    }

    /// One shipped migration exactly as production batches it: its statements,
    /// then the `user_version` stamp, all in a single transaction.
    fn shipped_migration_batch(version: i64) -> Vec<SqlStatement> {
        let (_, statements) = shipped_migrations()
            .into_iter()
            .find(|(candidate, _)| *candidate == version)
            .expect("the requested migration ships");
        statements
            .into_iter()
            .chain([format!("PRAGMA user_version = {version}")])
            .map(|sql| SqlStatement {
                sql,
                params: vec![],
                expected_rows_affected: None,
            })
            .collect()
    }

    /// A native database upgraded through shipped migrations 1-6, holding a
    /// finalized invoice and finalized/draft expense reports.
    async fn create_populated_v6_database(pool: &SqlitePool) {
        for version in 1..=6 {
            execute_statements(pool, shipped_migration_batch(version))
                .await
                .unwrap();
        }
        for sql in [
            r#"INSERT INTO invoices (id, year, seq, status, total_cents, snapshot_json)
               VALUES (1, 2026, 8, 'finalized', 4294, '{"invoiceNumber":"8-2026"}')"#,
            r#"INSERT INTO expense_reports
                 (id, year, seq, status, report_date, total_cents, snapshot_json)
               VALUES (1, 2026, 1, 'finalized', '2026-07-01', 7099, '{"reportNumber":"1-2026"}'),
                      (2, 2026, NULL, 'draft', '2026-07-03', 0, NULL)"#,
            "INSERT INTO expense_items
                 (id, expense_report_id, position, date, description, amount_cents)
             VALUES (1, 1, 0, '2026-06-05', 'Fuel', 4500),
                    (2, 1, 1, '2026-06-06', 'Printer paper', 2599)",
        ] {
            sqlx::query(sql).execute(pool).await.unwrap();
        }
    }

    async fn expense_items(pool: &SqlitePool) -> Vec<(i64, i64, String, i64)> {
        sqlx::query_as(
            "SELECT id, expense_report_id, description, amount_cents
               FROM expense_items ORDER BY id",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

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

    fn v6_migration_statements() -> Vec<SqlStatement> {
        [
            "ALTER TABLE invoices ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0",
            "PRAGMA user_version = 6",
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

        let mut connection = pool.acquire().await.unwrap();
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&mut *connection)
            .await
            .unwrap();
        assert!(sqlx::query(
            "INSERT INTO line_items (invoice_id, type, mileage_approver_id)
                 VALUES (1, 'completed', 999)"
        )
        .execute(&mut *connection)
        .await
        .is_err());
        sqlx::query("UPDATE line_items SET mileage_approver_id = 1 WHERE id = 1")
            .execute(&mut *connection)
            .await
            .unwrap();
        assert!(sqlx::query("DELETE FROM approvers WHERE id = 1")
            .execute(&mut *connection)
            .await
            .is_err());
        sqlx::query("UPDATE line_items SET mileage_approver_id = NULL WHERE id = 1")
            .execute(&mut *connection)
            .await
            .unwrap();
        let deleted = sqlx::query("DELETE FROM approvers WHERE id = 1")
            .execute(&mut *connection)
            .await
            .unwrap();
        assert_eq!(deleted.rows_affected(), 1);

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

    #[sqlx::test]
    async fn migrates_a_populated_version_5_database_to_version_6(pool: SqlitePool) {
        create_v4_line_items(&pool).await;
        execute_statements(&pool, v5_migration_statements())
            .await
            .unwrap();

        execute_statements(&pool, v6_migration_statements())
            .await
            .unwrap();

        let draft_revision: i64 =
            sqlx::query_scalar("SELECT draft_revision FROM invoices WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(draft_revision, 0);
        let revision_column: (String, String, i64, String) = sqlx::query_as(
            "SELECT name, type, \"notnull\", dflt_value
               FROM pragma_table_info('invoices')
              WHERE name = 'draft_revision'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            revision_column,
            ("draft_revision".into(), "INTEGER".into(), 1, "0".into())
        );
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(version, 6);
    }

    #[sqlx::test]
    async fn rolls_back_the_version_6_migration_when_a_later_statement_fails(pool: SqlitePool) {
        create_v4_line_items(&pool).await;
        execute_statements(&pool, v5_migration_statements())
            .await
            .unwrap();
        let mut statements = v6_migration_statements();
        statements.push(SqlStatement {
            sql: "INSERT INTO missing_table (id) VALUES (1)".into(),
            params: vec![],
            expected_rows_affected: None,
        });

        assert!(execute_statements(&pool, statements).await.is_err());

        let revision_column_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('invoices') WHERE name = 'draft_revision'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(revision_column_count, 0);
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(version, 5);
    }

    #[sqlx::test]
    async fn migrates_a_populated_version_6_database_to_version_7(pool: SqlitePool) {
        create_populated_v6_database(&pool).await;
        let items_before = expense_items(&pool).await;

        execute_statements(&pool, shipped_migration_batch(7))
            .await
            .unwrap();

        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(version, 7);
        assert_eq!(expense_items(&pool).await, items_before);
        let categories: Vec<String> =
            sqlx::query_scalar("SELECT category FROM expense_items ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(categories, ["general", "general"]);
        let snapshots: Vec<(String, Option<String>)> =
            sqlx::query_as("SELECT status, snapshot_json FROM expense_reports ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            snapshots,
            [
                (
                    "finalized".into(),
                    Some(r#"{"reportNumber":"1-2026"}"#.into())
                ),
                ("draft".into(), None),
            ]
        );
        let invoice: (i64, i64, String) =
            sqlx::query_as("SELECT seq, total_cents, snapshot_json FROM invoices WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(invoice, (8, 4294, r#"{"invoiceNumber":"8-2026"}"#.into()));

        let category_column: (String, i64, String) = sqlx::query_as(
            "SELECT type, \"notnull\", dflt_value FROM pragma_table_info('expense_items')
              WHERE name = 'category'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(category_column, ("TEXT".into(), 1, "'general'".into()));
        let trip_columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('mileage_trips') ORDER BY cid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            trip_columns,
            [
                "id",
                "mileage_report_id",
                "position",
                "date",
                "from_place",
                "to_place",
                "purpose",
                "start_odometer_km",
                "end_odometer_km",
            ]
        );
        let cascade: String = sqlx::query_scalar(
            "SELECT on_delete FROM pragma_foreign_key_list('mileage_trips')
              WHERE \"table\" = 'mileage_reports' AND \"from\" = 'mileage_report_id'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(cascade, "CASCADE");

        let mut connection = pool.acquire().await.unwrap();
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&mut *connection)
            .await
            .unwrap();
        for accepted in [
            "INSERT INTO expense_items (expense_report_id, category) VALUES (2, 'vehicle')",
            "INSERT INTO mileage_year_counters (year, last_seq) VALUES (2026, 1)",
            "INSERT INTO mileage_reports (id, year, seq, status, vehicle, total_km)
             VALUES (1, 2026, 1, 'finalized', 'Blue Civic', 120)",
            "INSERT INTO mileage_reports (id, year) VALUES (2, 2026)",
            "INSERT INTO mileage_reports (id, year) VALUES (3, 2026)",
            "INSERT INTO mileage_trips (mileage_report_id) VALUES (2)",
            "INSERT INTO mileage_trips (mileage_report_id, start_odometer_km, end_odometer_km)
             VALUES (2, 0, 0)",
            "INSERT INTO mileage_trips (mileage_report_id, start_odometer_km, end_odometer_km)
             VALUES (2, 900, 850)",
        ] {
            sqlx::query(accepted)
                .execute(&mut *connection)
                .await
                .unwrap_or_else(|error| panic!("{accepted}: {error}"));
        }
        for rejected in [
            "INSERT INTO expense_items (expense_report_id, category) VALUES (2, 'fuel')",
            "INSERT INTO expense_items (expense_report_id, category) VALUES (2, NULL)",
            "INSERT INTO mileage_year_counters (year, last_seq) VALUES (2027, 0)",
            "INSERT INTO mileage_reports (year, seq) VALUES (2026, 1)",
            "INSERT INTO mileage_reports (year, seq) VALUES (2026, 0)",
            "INSERT INTO mileage_reports (year, status) VALUES (2026, 'archived')",
            "INSERT INTO mileage_reports (year, total_km) VALUES (2026, -1)",
            "INSERT INTO mileage_trips (mileage_report_id, start_odometer_km) VALUES (2, -1)",
            "INSERT INTO mileage_trips (mileage_report_id, end_odometer_km) VALUES (2, -1)",
            "INSERT INTO mileage_trips (mileage_report_id) VALUES (999)",
        ] {
            let error = sqlx::query(rejected)
                .execute(&mut *connection)
                .await
                .expect_err(rejected);
            assert!(
                error.to_string().to_lowercase().contains("constraint"),
                "{rejected}: {error}"
            );
        }

        sqlx::query("DELETE FROM mileage_reports WHERE id = 2")
            .execute(&mut *connection)
            .await
            .unwrap();
        let remaining_trips: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM mileage_trips")
            .fetch_one(&mut *connection)
            .await
            .unwrap();
        assert_eq!(remaining_trips, 0);
    }

    #[sqlx::test]
    async fn rolls_back_the_version_7_migration_when_a_later_statement_fails(pool: SqlitePool) {
        create_populated_v6_database(&pool).await;
        let schema_query = "SELECT type, name, sql FROM sqlite_master ORDER BY type, name";
        let schema_before: Vec<(String, String, Option<String>)> =
            sqlx::query_as(schema_query).fetch_all(&pool).await.unwrap();
        let items_before = expense_items(&pool).await;
        let mut statements = shipped_migration_batch(7);
        statements.push(SqlStatement {
            sql: "INSERT INTO missing_table (id) VALUES (1)".into(),
            params: vec![],
            expected_rows_affected: None,
        });

        assert!(execute_statements(&pool, statements).await.is_err());

        let schema_after: Vec<(String, String, Option<String>)> =
            sqlx::query_as(schema_query).fetch_all(&pool).await.unwrap();
        assert_eq!(schema_after, schema_before);
        let category_column_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('expense_items') WHERE name = 'category'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(category_column_count, 0);
        assert_eq!(expense_items(&pool).await, items_before);
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(version, 6);
    }

    /// Finalize and restore batches captured from the TypeScript repository by
    /// `src/lib/db/identifierGuardNativeFixture.test.ts`. Every batch was computed from
    /// the same seeded state, in which every precheck passed, so running two of them
    /// reproduces writers racing past their prechecks.
    const IDENTIFIER_GUARD_FIXTURE: &str =
        include_str!("../test-fixtures/identifier-guard-batches.json");

    /// How a batch rejected by an activating UPDATE's guard is reported.
    const GUARD_REJECTION: &str = "Expected 1 row(s) affected; affected 0.";

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GuardInvoiceIds {
        /// Cancelled; completed row R-100 / RACEVIN1; holds number 1-2026.
        cancelled: i64,
        /// Draft, automatic number 6-2026 (drafts already hold 4 and 5); completed row
        /// R-200 / RACEVIN1.
        completed_a: i64,
        /// Draft, automatic 2027 number; completed row R-300 / RACEVIN1.
        completed_b: i64,
        /// Draft, manual number 4-2026; completed row R-100 / OTHERVN1.
        inspection_c: i64,
        /// Draft, manual number 5-2026; no-show row R-100 / RACEVIN1.
        no_show: i64,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct IdentifierGuardFixture {
        ids: GuardInvoiceIds,
        seed: Vec<SqlStatement>,
        finalize_a: Vec<SqlStatement>,
        finalize_b: Vec<SqlStatement>,
        finalize_c: Vec<SqlStatement>,
        finalize_no_show: Vec<SqlStatement>,
        restore_cancelled: Vec<SqlStatement>,
    }

    /// The fixture's rows on a database built from every shipped migration.
    async fn identifier_guard_database(pool: &SqlitePool) -> IdentifierGuardFixture {
        let mut fixture: IdentifierGuardFixture =
            serde_json::from_str(IDENTIFIER_GUARD_FIXTURE).expect("valid identifier fixture");
        for (version, _) in shipped_migrations() {
            execute_statements(pool, shipped_migration_batch(version))
                .await
                .unwrap();
        }
        execute_statements(pool, std::mem::take(&mut fixture.seed))
            .await
            .unwrap();
        fixture
    }

    /// `(status, seq, has a snapshot)` for one invoice.
    async fn invoice_state(pool: &SqlitePool, id: i64) -> (String, Option<i64>, bool) {
        sqlx::query_as("SELECT status, seq, snapshot_json IS NOT NULL FROM invoices WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn year_counters(pool: &SqlitePool) -> Vec<(i64, i64)> {
        sqlx::query_as("SELECT year, last_seq FROM year_counters ORDER BY year")
            .fetch_all(pool)
            .await
            .unwrap()
    }

    fn draft(seq: Option<i64>) -> (String, Option<i64>, bool) {
        ("draft".into(), seq, false)
    }

    fn active(seq: i64) -> (String, Option<i64>, bool) {
        ("finalized".into(), Some(seq), true)
    }

    /// Runs two batches as concurrent writers on their own pooled connections. Another
    /// connection holds SQLite's write lock until both have started, so both queue on the
    /// same lock; returns each result in argument order.
    async fn contend(
        pool: &SqlitePool,
        first: Vec<SqlStatement>,
        second: Vec<SqlStatement>,
    ) -> [Result<Vec<SqlStatementResult>, String>; 2] {
        let mut holder = pool.acquire().await.unwrap();
        sqlx::query("BEGIN IMMEDIATE")
            .execute(&mut *holder)
            .await
            .unwrap();
        let writer = |batch: Vec<SqlStatement>| {
            let pool = pool.clone();
            tauri::async_runtime::spawn(async move {
                let started = Instant::now();
                let result = execute_statements(&pool, batch).await;
                (started, Instant::now(), result)
            })
        };
        let writers = [writer(first), writer(second)];
        // Far below the 5 s busy timeout, so both writers stay queued on the lock.
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(250)))
            .await
            .unwrap();
        let released = Instant::now();
        sqlx::query("COMMIT").execute(&mut *holder).await.unwrap();

        let mut results = Vec::with_capacity(2);
        for writer in writers {
            let (started, finished, result) = writer.await.unwrap();
            assert!(
                started < released && finished > released,
                "each writer must have waited on the held write lock"
            );
            results.push(result);
        }
        results.try_into().expect("two writer results")
    }

    #[sqlx::test]
    async fn replayed_batches_bill_each_completed_identifier_once(pool: SqlitePool) {
        let IdentifierGuardFixture {
            ids,
            finalize_a,
            finalize_b,
            finalize_c,
            finalize_no_show,
            restore_cancelled,
            ..
        } = identifier_guard_database(&pool).await;

        execute_statements(&pool, finalize_a).await.unwrap();
        assert_eq!(invoice_state(&pool, ids.completed_a).await, active(6));

        // Same VIN in another year: the guard rejects it and its 2027 reservation rolls back.
        assert_eq!(
            execute_statements(&pool, finalize_b).await.unwrap_err(),
            GUARD_REJECTION
        );
        assert_eq!(invoice_state(&pool, ids.completed_b).await, draft(None));
        assert_eq!(year_counters(&pool).await, [(2026, 6)]);

        assert_eq!(
            execute_statements(&pool, restore_cancelled)
                .await
                .unwrap_err(),
            GUARD_REJECTION
        );
        assert_eq!(
            invoice_state(&pool, ids.cancelled).await,
            ("void".into(), Some(1), true)
        );

        // A no-show never reserves or collides, even with a billed VIN and inspection #.
        execute_statements(&pool, finalize_no_show).await.unwrap();
        assert_eq!(invoice_state(&pool, ids.no_show).await, active(5));
        // R-100 is otherwise only on the cancelled invoice and the no-show.
        execute_statements(&pool, finalize_c).await.unwrap();
        assert_eq!(invoice_state(&pool, ids.inspection_c).await, active(4));
        assert_eq!(year_counters(&pool).await, [(2026, 6)]);
    }

    #[sqlx::test]
    async fn contending_finalizations_of_one_vin_commit_exactly_one(pool: SqlitePool) {
        let IdentifierGuardFixture {
            ids,
            finalize_a,
            finalize_b,
            ..
        } = identifier_guard_database(&pool).await;

        let [a, b] = contend(&pool, finalize_a, finalize_b).await;

        assert_ne!(a.is_ok(), b.is_ok(), "exactly one finalization commits");
        if a.is_ok() {
            assert_eq!(b.unwrap_err(), GUARD_REJECTION);
            assert_eq!(invoice_state(&pool, ids.completed_a).await, active(6));
            assert_eq!(invoice_state(&pool, ids.completed_b).await, draft(None));
            assert_eq!(year_counters(&pool).await, [(2026, 6)]);
        } else {
            assert_eq!(a.unwrap_err(), GUARD_REJECTION);
            assert_eq!(invoice_state(&pool, ids.completed_a).await, draft(None));
            assert_eq!(invoice_state(&pool, ids.completed_b).await, active(1));
            assert_eq!(year_counters(&pool).await, [(2026, 1), (2027, 1)]);
        }
    }

    #[sqlx::test]
    async fn contending_restore_and_finalize_of_one_inspection_commit_exactly_one(
        pool: SqlitePool,
    ) {
        let IdentifierGuardFixture {
            ids,
            finalize_c,
            finalize_no_show,
            restore_cancelled,
            ..
        } = identifier_guard_database(&pool).await;

        let [restored, finalized] = contend(&pool, restore_cancelled, finalize_c).await;

        assert_ne!(restored.is_ok(), finalized.is_ok(), "exactly one commits");
        if restored.is_ok() {
            assert_eq!(finalized.unwrap_err(), GUARD_REJECTION);
            assert_eq!(invoice_state(&pool, ids.cancelled).await, active(1));
            assert_eq!(invoice_state(&pool, ids.inspection_c).await, draft(Some(4)));
            assert_eq!(year_counters(&pool).await, [(2026, 1)]);
        } else {
            assert_eq!(restored.unwrap_err(), GUARD_REJECTION);
            assert_eq!(
                invoice_state(&pool, ids.cancelled).await,
                ("void".into(), Some(1), true)
            );
            assert_eq!(invoice_state(&pool, ids.inspection_c).await, active(4));
            assert_eq!(year_counters(&pool).await, [(2026, 4)]);
        }
        execute_statements(&pool, finalize_no_show).await.unwrap();
        assert_eq!(invoice_state(&pool, ids.no_show).await, active(5));
    }
}
