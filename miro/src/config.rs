use crate::error::{AppError, AppResult};
use config::{Config, ConfigError, Environment, File};
use convert_case::Case;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct CliConfig {
    pub access_token: Option<SecretString>,
    pub team_id: Option<String>,
    pub api_base_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
struct SerializableConfig {
    access_token: Option<String>,
    team_id: Option<String>,
    api_base_url: Option<String>,
}

impl From<&CliConfig> for SerializableConfig {
    fn from(config: &CliConfig) -> Self {
        Self {
            access_token: config
                .access_token
                .as_ref()
                .map(|s| s.expose_secret().to_string()),
            team_id: config.team_id.clone(),
            api_base_url: config.api_base_url.clone(),
        }
    }
}

impl CliConfig {
    pub fn new() -> Result<Self, ConfigError> {
        let mut builder = Config::builder();

        if let Some(config_path) = Self::config_path() {
            if config_path.exists() {
                builder = builder.add_source(File::from(config_path));
            }
        }

        builder = builder.add_source(
            Environment::with_prefix("MIRO")
                .try_parsing(true)
                .convert_case(Case::Kebab),
        );

        builder.build()?.try_deserialize()
    }

    fn config_path() -> Option<std::path::PathBuf> {
        dirs::config_dir().map(|mut path| {
            path.push("miro-cli");
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
