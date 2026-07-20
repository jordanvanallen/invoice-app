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
    use sqlx::SqlitePool;

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
}
