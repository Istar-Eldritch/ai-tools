use httpmock::prelude::*;
use plane_cli::api::client::Client;
use plane_cli::config::CliConfig;
use secrecy::SecretString;

pub fn setup_mock_server() -> (MockServer, Client) {
    let server = MockServer::start();
    let config = CliConfig {
        api_key: Some(SecretString::new("test-api-key".to_string().into())),
        workspace: Some("test-workspace".to_string()),
        project: None,
        api_base_url: Some(server.base_url().to_string()),
    };
    let client = Client::new(&config).unwrap();

    (server, client)
}
