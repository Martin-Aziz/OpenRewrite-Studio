use serde::Serialize;
use std::time::Duration;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceHealth {
    api_online: bool,
    ai_service_online: bool,
    ollama_online: bool,
    api_url: String,
    ai_service_url: String,
    ollama_url: String,
}

#[tauri::command]
fn desktop_config() -> serde_json::Value {
    serde_json::json!({
        "appName": "OpenRewrite Studio",
        "defaultProvider": "ollama",
        "recommendedWorkflow": "Use the browser app as the primary product and this Tauri shell for native install, shortcuts, and local model workflows."
    })
}

#[tauri::command]
fn service_health() -> ServiceHealth {
    let api_url = "http://localhost:8080/health".to_string();
    let ai_service_url = "http://localhost:8000/health".to_string();
    let ollama_url = "http://localhost:11434/api/tags".to_string();

    ServiceHealth {
        api_online: is_online(&api_url),
        ai_service_online: is_online(&ai_service_url),
        ollama_online: is_online(&ollama_url),
        api_url,
        ai_service_url,
        ollama_url,
    }
}

fn is_online(url: &str) -> bool {
    let config = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(2)))
        .build();
    let agent = ureq::Agent::new_with_config(config);
    agent.get(url).call().is_ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![desktop_config, service_health])
        .run(tauri::generate_context!())
        .expect("failed to run OpenRewrite Studio desktop app");
}
