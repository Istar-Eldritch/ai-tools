use oauth2::basic::BasicClient;
use oauth2::{
    AuthUrl, ClientId, ClientSecret, RedirectUrl, TokenUrl,
    AuthorizationCode, TokenResponse,
    reqwest::async_http_client,
};

use crate::error::{AppError, AppResult};

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v3/userinfo";

/// Wrapper around an OAuth2 BasicClient configured for Google.
#[derive(Clone)]
pub struct GoogleOAuthClient {
    client: BasicClient,
    http_client: reqwest::Client,
}

/// Information extracted from Google's userinfo endpoint.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct GoogleUserInfo {
    pub sub: String,
    pub email: String,
    pub name: Option<String>,
}

impl GoogleOAuthClient {
    pub fn new(
        client_id: &str,
        client_secret: &str,
        redirect_uri: &str,
    ) -> AppResult<Self> {
        let client = BasicClient::new(
            ClientId::new(client_id.to_owned()),
            Some(ClientSecret::new(client_secret.to_owned())),
            AuthUrl::new(GOOGLE_AUTH_URL.to_owned())
                .map_err(|e| AppError::Config(format!("invalid auth URL: {e}")))?,
            Some(
                TokenUrl::new(GOOGLE_TOKEN_URL.to_owned())
                    .map_err(|e| AppError::Config(format!("invalid token URL: {e}")))?,
            ),
        )
        .set_redirect_uri(
            RedirectUrl::new(redirect_uri.to_owned())
                .map_err(|e| AppError::Config(format!("invalid redirect URI: {e}")))?,
        );

        let http_client = reqwest::Client::new();

        Ok(Self {
            client,
            http_client,
        })
    }

    /// Exchange an authorization code for tokens and fetch user info.
    pub async fn exchange_code(&self, code: &str) -> AppResult<GoogleUserInfo> {
        let token_response = self
            .client
            .exchange_code(AuthorizationCode::new(code.to_owned()))
            .request_async(async_http_client)
            .await
            .map_err(|e| AppError::Internal(format!("Google token exchange failed: {e}")))?;

        let access_token = token_response.access_token().secret();

        let user_info: GoogleUserInfo = self
            .http_client
            .get(GOOGLE_USERINFO_URL)
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Google userinfo request failed: {e}")))?
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("Google userinfo parse failed: {e}")))?;

        Ok(user_info)
    }
}
