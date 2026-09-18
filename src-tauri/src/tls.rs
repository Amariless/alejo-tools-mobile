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

// ══════════════════════════════════════════════════════════════════════════
//  NUEVO (bug real reportado por el usuario -- "No se pudo conectar con
//  Syncthing ... invalid peer certificate: UnknownIssuer"): Syncthing sirve
//  su API en 127.0.0.1:8384 con un certificado AUTOFIRMADO por default en
//  versiones recientes -- un autofirmado nunca va a validar contra
//  webpki-roots (CAs públicas reales), que es lo único que tls_config() de
//  acá arriba acepta. En vez de aflojar la verificación para TODO el
//  tráfico de la app (inseguro -- así perdería sentido tener
//  webpki-roots), este verificador solo confía ciegamente cuando el host
//  al que nos conectamos es loopback: una conexión que nunca sale del
//  propio dispositivo no tiene ningún tercero real en el medio que pueda
//  explotar esa confianza (el "atacante" ya tendría que ser otra app o
//  root en el mismo teléfono, con o sin TLS de por medio). Para cualquier
//  otro host, delega en el verificador real (mismas raíces webpki).
// ══════════════════════════════════════════════════════════════════════════

#[derive(Debug)]
struct LoopbackTolerantVerifier {
    strict: std::sync::Arc<dyn rustls::client::danger::ServerCertVerifier>,
}

fn is_loopback_server_name(name: &rustls::pki_types::ServerName<'_>) -> bool {
    match name {
        rustls::pki_types::ServerName::IpAddress(ip) => std::net::IpAddr::from(*ip).is_loopback(),
        rustls::pki_types::ServerName::DnsName(dns) => dns.as_ref().eq_ignore_ascii_case("localhost"),
        _ => false,
    }
}

impl rustls::client::danger::ServerCertVerifier for LoopbackTolerantVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        intermediates: &[rustls::pki_types::CertificateDer<'_>],
        server_name: &rustls::pki_types::ServerName<'_>,
        ocsp_response: &[u8],
        now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        if is_loopback_server_name(server_name) {
            return Ok(rustls::client::danger::ServerCertVerified::assertion());
        }
        self.strict.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        self.strict.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        self.strict.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.strict.supported_verify_schemes()
    }
}

fn tls_config_trusting_loopback() -> rustls::ClientConfig {
    let strict = rustls::client::WebPkiServerVerifier::builder(std::sync::Arc::new(root_store()))
        .build()
        .expect("no se pudo armar el verificador TLS estricto");
    let verifier = std::sync::Arc::new(LoopbackTolerantVerifier { strict });
    rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
        .with_protocol_versions(rustls::ALL_VERSIONS)
        .expect("versiones TLS soportadas")
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth()
}

/// Mismo cliente que client(), pero confía ciegamente en certificados
/// autofirmados cuando el host es loopback (127.0.0.1/::1/localhost) --
/// pensado específicamente para SyncManager (syncthing.rs), que habla con
/// la API local de Syncthing-Android. NO usar para tráfico a internet real.
pub fn client_trusting_loopback(user_agent: &str, timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .use_preconfigured_tls(tls_config_trusting_loopback())
        .user_agent(user_agent.to_string())
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .expect("no se pudo construir el cliente HTTP")
}
