// tls.rs — cliente HTTP compartido (SyncManager + auto-actualización) con
// TLS preconfigurado a mano.
//
// Por qué existe este archivo: reqwest, con su backend rustls por
// defecto, en Android usa rustls-platform-verifier (verificación de
// certificados vía el keystore de Android, a través de JNI) -- confirmado
// en vivo que esto panickea en tiempo de ejecución ("Expect
// rustls-platform-verifier to be initialized") porque necesita que la
// app inicialice el puente JNI a mano, y según el propio README del
// crate eso requiere agregar un componente Kotlin al build.gradle, no
// alcanza con Cargo.toml. En vez de meternos con Gradle/Kotlin para esto,
// se arma un rustls::ClientConfig con raíces de confianza embebidas
// (webpki-roots, el set de Mozilla) vía use_preconfigured_tls() -- eso
// evita por completo el camino de rustls-platform-verifier. Suficiente
// para hablar con api.github.com (auto-actualización); SyncManager habla
// con 127.0.0.1 en texto plano (sin TLS de por medio), pero usa el mismo
// cliente por si alguna vez apunta a un host https.
use std::sync::OnceLock;

static ROOT_STORE: OnceLock<rustls::RootCertStore> = OnceLock::new();

fn root_store() -> rustls::RootCertStore {
    ROOT_STORE.get_or_init(|| {
        let mut store = rustls::RootCertStore::empty();
        store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        store
    }).clone()
}

fn tls_config() -> rustls::ClientConfig {
    rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
        .with_protocol_versions(rustls::ALL_VERSIONS)
        .expect("versiones TLS soportadas")
        .with_root_certificates(root_store())
        .with_no_client_auth()
}

/// Cliente reqwest listo para usar, con user-agent y timeout ya puestos.
pub fn client(user_agent: &str, timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .use_preconfigured_tls(tls_config())
        .user_agent(user_agent.to_string())
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .expect("no se pudo construir el cliente HTTP")
}
