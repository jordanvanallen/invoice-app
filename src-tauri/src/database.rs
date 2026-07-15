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
}

/// Execute every supplied statement on one SQLite transaction/connection.
async fn execute_statements(
    pool: &Pool<Sqlite>,
    statements: Vec<SqlStatement>,
) -> Result<(), String> {
    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
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
        query
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

/// Execute every supplied statement on one SQLite transaction/connection.
#[tauri::command]
pub async fn execute_sqlite_transaction(
    db_instances: State<'_, DbInstances>,
    db: String,
    statements: Vec<SqlStatement>,
) -> Result<(), String> {
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
                },
                SqlStatement {
                    sql: "INSERT INTO values_test (value) VALUES (?)".into(),
                    params: vec![json!(1)],
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
}
