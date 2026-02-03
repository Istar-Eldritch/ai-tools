use crate::error::{AppError, AppResult};
use config::{Config, ConfigError, Environment, File};
use convert_case::Case;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct CliConfig {
    pub api_key: Option<SecretString>,
    pub workspace: Option<String>,
    pub project: Option<String>,
    pub api_base_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct SerializableConfig {
    api_key: Option<String>,
    workspace: Option<String>,
    project: Option<String>,
    api_base_url: Option<String>,
}

impl From<&CliConfig> for SerializableConfig {
    fn from(config: &CliConfig) -> Self {
        Self {
            api_key: config
                .api_key
                .as_ref()
                .map(|s| s.expose_secret().to_string()),
            workspace: config.workspace.clone(),
            project: config.project.clone(),
            api_base_url: config.api_base_url.clone(),
        }
    }
}

impl CliConfig {
    pub fn new() -> Result<Self, ConfigError> {
        let mut builder = Config::builder();

        // Look for config file in ~/.config/plane-cli/config.toml
        if let Some(config_path) = Self::config_path() {
            if config_path.exists() {
                builder = builder.add_source(File::from(config_path));
            }
        }

        // Look for environment variables
        // The convert_case(Case::Kebab) ensures that PLANE_API_BASE_URL
        // is converted to api-base-url to match the serde kebab-case rename
        // Note: We don't use separator("_") because that would create nested paths
        // (api.base.url) instead of flat keys (api-base-url)
        builder = builder.add_source(
            Environment::with_prefix("PLANE")
                .try_parsing(true)
                .convert_case(Case::Kebab),
        );

        builder.build()?.try_deserialize()
    }

    fn config_path() -> Option<std::path::PathBuf> {
        dirs::config_dir().map(|mut path| {
            path.push("plane-cli");
            path.push("config.toml");
            path
        })
    }

    pub fn save(&self) -> AppResult<()> {
        let config_path = Self::config_path()
            .ok_or_else(|| AppError::General("Could not determine config path".to_string()))?;
        let config_dir = config_path.parent().unwrap();
        fs::create_dir_all(config_dir)?;

        let serializable_config = SerializableConfig::from(self);
        let config_str = toml::to_string(&serializable_config)?;
        fs::write(config_path, config_str)?;
        Ok(())
    }
}
