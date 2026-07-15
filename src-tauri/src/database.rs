use serde::Deserialize;
use serde_json::Value;
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
