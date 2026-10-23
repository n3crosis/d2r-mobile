# Optional local signing

You do not need Xcode, Python, .NET or command-line tools to generate an IPA in
this browser packager. Signing here is optional and uses the existing local zsign
worker. Leave it off for an unsigned download. Preparing a new Apple signing
identity is a separate, optional setup task; the non-Mac method below uses OpenSSL.
The page never asks for your Apple Account password or creates credentials for you.

## Already have an identity and profile?

1. Check that the P12/PFX contains both your signing certificate and its private
   key. A downloaded `.cer` file alone cannot sign.
2. The provisioning profile must include that certificate, the same team, the
   app's Bundle ID and your registered device. Set the Bundle ID in App
   customization to match the profile before generating. Do not assume the
   default `org.d2rmobile.app` identifier is available to your team.
3. Enable optional local signing, choose the P12/PFX and `.mobileprovision`, and
   enter the P12 **export password**, not your Apple Account password. A blank
   password is only appropriate for an existing passwordless identity.

## Prepare your own identity

This manual Apple Distribution / Ad Hoc workflow requires an Apple Developer
Program team and Account Holder or Admin access, not only a free Apple Account.
Use only certificates and devices you are authorized to manage. Never upload your
private key, P12 or export password to an online converter or signing service.

### Mac

Use Apple's [CSR instructions](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request)
if you need a new certificate. Submit the CSR, not the private key, in your team's
Certificates portal to issue an Apple Distribution certificate. Import the
returned certificate into the keychain containing the original private key.
Select the matching certificate and private key in Keychain Access, then use
File → Export Items and save as password-protected P12. Apple documents
[keychain export](https://support.apple.com/guide/keychain-access/import-and-export-keychain-items-kyca35961/mac)
and [exporting a signing certificate from Xcode](https://help.apple.com/xcode/mac/current/en.lproj/dev154b28f09.html).
Xcode is an alternative for existing users, not a requirement for this packager.

### Without a Mac

Run these commands yourself with a trusted local OpenSSL installation in a private
working directory. They are preparation instructions, not browser requirements.
Use fresh filenames; do not overwrite an existing key.

```sh
openssl genrsa -aes256 -out distribution.key 2048
openssl req -new -sha256 -key distribution.key -out distribution.csr
```

Choose a strong private-key passphrase and complete the CSR prompts. Keep
`distribution.key` private. In your Apple Developer team's Certificates portal,
create an Apple Distribution certificate using **only** `distribution.csr` and
download the issued certificate. Substitute its actual filename below:

```sh
openssl x509 -inform DER -in distribution.cer -out distribution.pem
openssl pkcs12 -export -inkey distribution.key -in distribution.pem -out distribution.p12
```

Enter the private-key passphrase when asked, then choose a strong P12 export
password. These are separate passwords; the browser needs the latter.

Sources: OpenSSL [genrsa](https://docs.openssl.org/3.5/man1/openssl-genrsa/),
[req](https://docs.openssl.org/3.5/man1/openssl-req/),
[x509](https://docs.openssl.org/3.5/man1/openssl-x509/) and
[PKCS#12 export](https://docs.openssl.org/3.5/man1/openssl-pkcs12/).
The supplied [Feather non-Mac guide](https://github.com/claration/feather/wiki/Apple-Developer-Account-Non%E2%80%90Mac)
was consulted only for its preparation flow. Its later third-party upload route
is **not** used or recommended here; the key-generation command above explicitly
encrypts the key rather than copying its unencrypted example.

## Prepare the provisioning profile

1. In the same team, [register your device's UDID](https://developer.apple.com/help/account/devices/register-a-single-device)
   and an explicit App ID with the Bundle ID you intend to use. Do not enable
   unrelated capabilities just because another app's guide suggests them.
2. In Certificates, Identifiers & Profiles → Profiles → +, choose Distribution →
   **Ad Hoc**. Select that App ID, the same distribution certificate and your
   registered device(s), then generate and download the `.mobileprovision`.
3. Regenerate the profile if you add a device or replace the certificate. Renew
   expired credentials using the same team and Bundle ID. Back up saves; do not
   delete the installed app simply to refresh its signature, because doing so can
   remove its saves and resources.

See Apple's [Ad Hoc profile instructions](https://developer.apple.com/help/account/provisioning-profiles/create-an-ad-hoc-provisioning-profile/)
and [certificate roles](https://developer.apple.com/help/account/certificates/certificates-overview/).
Apple's Ad Hoc distribution profile is not the signer's unsupported cryptographic
“ad-hoc signature” mode; the latter has no certificate/profile identity.

## What the browser does and does not promise

Signing inputs are processed locally, not uploaded. The P12 and password are not
included in the output IPA; the provisioning profile is intentionally embedded,
so consider its contents before sharing the IPA. This is not a guarantee of
forensic erasure from browser memory.

The signer checks bounded inputs, certificate/profile dates, team/certificate
membership and Bundle ID compatibility. It does not verify Apple trust,
revocation or device eligibility, and some profile capabilities are unsupported.
The underlying file-size checks remain in effect. Signing failure preserves the
unsigned output and completed resources for retry; it does not prove installation
will work.

## Install, then copy resources

Download and install the signed IPA separately. On Mac, Apple Configurator can
[add an IPA to a connected device](https://support.apple.com/guide/apple-configurator-mac/add-apps-to-a-device-cad4cd08c03/mac):
select the device → Add → Apps → Choose from my Mac. This is not signing an
unsigned IPA. Open the installed app once to create its Files folder.

Use the result panel's **actual output names**, and copy only completed exports.
On Mac, drag each whole resource folder onto the app in Finder → device → Files,
as documented in this project's [game-file instructions](../docs/GAME_FILES.md).
Windows Apple Devices can [transfer files to the app](https://support.apple.com/guide/devices-windows/transfer-files-between-your-devices-mchl4bd77d3a/windows).
If a transfer tool rejects folders, ZIP the complete folder, transfer the ZIP,
then [extract it in Files](https://support.apple.com/en-us/102532). Keep the actual
resource folder directly inside the app folder, without an extra ZIP wrapper,
and allow space for both archive and extracted files.

Keep the folder name and nested `data` structure unchanged. Copy a completed
older-device pack alongside it if one was generated. Wait for copying to finish,
then return to the app and tap Retry. NSP/XCI and key files are not needed on the
phone. Signing, downloading and reading instructions never mark device work done.
