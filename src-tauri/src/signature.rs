//! Cosign-style ECDSA P-256 blob signature verification.
//!
//! This intentionally does *not* pull in the full `sigstore-rs` crate.
//! We support the simplest-useful subset of Sigstore's surface area — a
//! keyed blob signature — which is what `cosign sign-blob --key
//! cosign.key <file>` emits and what most release maintainers start
//! with. Keyless (Fulcio + Rekor) verification is a planned follow-up.
//!
//! Wire format (matches `cosign`):
//!   - `signature` is base64-encoded ASN.1 DER ECDSA signature over
//!     SHA-256(artifact) using a P-256 keypair.
//!   - `public_key_pem` is a PEM-encoded SubjectPublicKeyInfo.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use p256::ecdsa::{signature::Verifier, Signature, VerifyingKey};
use p256::pkcs8::DecodePublicKey;

#[derive(Debug, thiserror::Error)]
pub enum SignatureError {
    #[error("failed to decode base64 signature: {0}")]
    BadBase64(#[from] base64::DecodeError),
    #[error("failed to parse ECDSA signature: {0}")]
    BadSignatureEncoding(String),
    #[error("failed to parse public key: {0}")]
    BadPublicKey(String),
    #[error("signature does not match artifact (tampered payload or wrong key)")]
    Mismatch,
}

/// Verify a cosign-compatible ECDSA P-256 signature over `artifact`.
///
/// `signature_b64` may contain surrounding whitespace (newlines from
/// `cosign`'s output are common) — we trim before decoding.
pub fn verify_cosign_blob(
    artifact: &[u8],
    signature_b64: &str,
    public_key_pem: &str,
) -> Result<(), SignatureError> {
    let sig_bytes = STANDARD.decode(signature_b64.trim().as_bytes())?;

    // Cosign historically emits DER; accept raw (r || s) as a fallback
    // for tooling that produces fixed-length signatures.
    let signature = Signature::from_der(&sig_bytes)
        .or_else(|_| Signature::from_slice(&sig_bytes))
        .map_err(|e| SignatureError::BadSignatureEncoding(e.to_string()))?;

    let verifying_key = VerifyingKey::from_public_key_pem(public_key_pem)
        .map_err(|e| SignatureError::BadPublicKey(e.to_string()))?;

    verifying_key
        .verify(artifact, &signature)
        .map_err(|_| SignatureError::Mismatch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{signature::Signer, Signature as SigningSignature, SigningKey};
    use p256::pkcs8::EncodePublicKey;
    use rand_core::OsRng;

    fn fixture() -> (String, String, Vec<u8>) {
        let signing = SigningKey::random(&mut OsRng);
        let pem = signing
            .verifying_key()
            .to_public_key_pem(Default::default())
            .expect("encode pem");
        let payload = b"hello, appstore artifact bytes".to_vec();
        let sig: SigningSignature = signing.sign(&payload);
        let sig_b64 = STANDARD.encode(sig.to_der().as_bytes());
        (pem, sig_b64, payload)
    }

    #[test]
    fn verifies_valid_cosign_signature() {
        let (pem, sig, payload) = fixture();
        verify_cosign_blob(&payload, &sig, &pem).expect("valid signature must verify");
    }

    #[test]
    fn rejects_tampered_payload() {
        let (pem, sig, mut payload) = fixture();
        payload[0] ^= 0x01;
        let err = verify_cosign_blob(&payload, &sig, &pem)
            .expect_err("tampered payload must fail verification");
        assert!(matches!(err, SignatureError::Mismatch));
    }

    #[test]
    fn rejects_wrong_public_key() {
        let (_pem, sig, payload) = fixture();
        let (other_pem, _, _) = fixture();
        let err = verify_cosign_blob(&payload, &sig, &other_pem)
            .expect_err("unrelated key must fail verification");
        assert!(matches!(err, SignatureError::Mismatch));
    }

    #[test]
    fn rejects_malformed_base64() {
        let (pem, _, payload) = fixture();
        let err = verify_cosign_blob(&payload, "!!!not base64!!!", &pem)
            .expect_err("bad base64 must be reported");
        assert!(matches!(err, SignatureError::BadBase64(_)));
    }

    #[test]
    fn rejects_malformed_public_key() {
        let (_pem, sig, payload) = fixture();
        let err = verify_cosign_blob(
            &payload,
            &sig,
            "-----BEGIN PUBLIC KEY-----\nnope\n-----END PUBLIC KEY-----\n",
        )
        .expect_err("bad pem must be reported");
        assert!(matches!(err, SignatureError::BadPublicKey(_)));
    }

    #[test]
    fn accepts_signature_with_surrounding_whitespace() {
        let (pem, sig, payload) = fixture();
        let padded = format!("\n  {}\n\n", sig);
        verify_cosign_blob(&payload, &padded, &pem).expect("whitespace-padded sig must verify");
    }
}
