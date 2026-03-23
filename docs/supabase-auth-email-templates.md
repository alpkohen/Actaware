# ActAware — Supabase Auth e-posta şablonları

Supabase varsayılanı `noreply@mail.app.supabase.io` ve düz metin görünümü. **Gönderen adresi** ve **şablon** iki ayrı ayardır.

## 1. Şablonları nereye yapıştıracaksın?

1. [Supabase Dashboard](https://supabase.com/dashboard) → projen → **Authentication** → **Email Templates**
2. Sırayla:
   - **Magic link** — `dashboard.html` girişi (`signInWithOtp`) bunu kullanır
   - **Confirm signup** — ilk kayıtta “Confirm your signup”
3. Her şablonda **Subject** satırını da aşağıdaki önerilerle değiştir
4. Gövdeye aşağıdaki HTML’i yapıştır (Go template değişkenlerini **silme**)

## 2. Konu (Subject) önerileri

| Şablon        | Subject önerisi                    |
|---------------|------------------------------------|
| Magic link    | `Sign in to ActAware`              |
| Confirm signup| `Confirm your ActAware account`    |

## 3. Özel gönderen (ActAware adresinden gelsin)

Şablon ne kadar güzel olursa olsun, **SMTP kapalıyken** gönderen genelde Supabase altyapısı kalır.

**Seçenek A — Resend (zaten kullanıyorsun)**  
**Authentication** → **Providers** → **Email** → **SMTP Settings** aç:

| Alan | Örnek |
|------|--------|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) |
| Username | `resend` |
| Password | Resend API key (`re_...`) |
| Sender email | Resend’de doğrulanmış domain, örn. `ActAware <auth@actaware.co.uk>` veya geçici `onboarding@resend.dev` |

Sonra şablonları yine aynı yerden düzenlemeye devam edersin.

**Seçenek B — Sadece şablon**  
SMTP eklemeden yalnızca HTML’i değiştirebilirsin; görünüm ActAware olur, **From** adresi yine Supabase olabilir.

---

## 4. Magic link — HTML gövde

Subject: `Sign in to ActAware`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign in to ActAware</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(11,24,41,0.08);border:1px solid #e5e7eb;">
          <tr>
            <td style="background-color:#0B1829;padding:28px 32px;text-align:center;">
              <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:600;color:#ffffff;letter-spacing:-0.3px;">
                Act<span style="color:#C9922A;">Aware</span>
              </p>
              <p style="margin:10px 0 0;font-size:12px;color:rgba(255,255,255,0.55);letter-spacing:2px;text-transform:uppercase;">UK employer compliance</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 28px;">
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#0B1829;line-height:1.3;">Sign in to your alerts</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4b5563;">Click the button below to open your ActAware dashboard. This link expires soon and can only be used once.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="border-radius:8px;background-color:#0B1829;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Open ActAware</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.55;color:#9ca3af;">If the button doesn’t work, paste this link into your browser:<br><a href="{{ .ConfirmationURL }}" style="color:#1e3051;word-break:break-all;">{{ .ConfirmationURL }}</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid #f3f4f6;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">You requested this email to sign in to ActAware. If you didn’t, you can ignore it.</p>
              <p style="margin:12px 0 0;font-size:12px;color:#d1d5db;">{{ .Email }}</p>
            </td>
          </tr>
        </table>
        <p style="margin:24px 0 0;font-size:11px;color:#9ca3af;max-width:480px;">ActAware is a trading name of Uniq Trading and Consulting Limited (UK).</p>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 5. Confirm signup — HTML gövde

Subject: `Confirm your ActAware account`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm your ActAware account</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(11,24,41,0.08);border:1px solid #e5e7eb;">
          <tr>
            <td style="background-color:#0B1829;padding:28px 32px;text-align:center;">
              <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:600;color:#ffffff;">
                Act<span style="color:#C9922A;">Aware</span>
              </p>
              <p style="margin:10px 0 0;font-size:12px;color:rgba(255,255,255,0.55);letter-spacing:2px;text-transform:uppercase;">UK employer compliance</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 28px;">
              <h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#0B1829;">Confirm your email</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4b5563;">Welcome to ActAware. Confirm your address to finish setting up your account.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="border-radius:8px;background-color:#C9922A;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#0B1829;text-decoration:none;border-radius:8px;">Confirm email</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.55;color:#9ca3af;">Or copy this link:<br><a href="{{ .ConfirmationURL }}" style="color:#1e3051;word-break:break-all;">{{ .ConfirmationURL }}</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid #f3f4f6;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">If you didn’t create an ActAware account, you can ignore this message.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

---

## 6. Kontrol listesi

- [ ] **URL Configuration** → Redirect URLs’de `https://act-aware.netlify.app/dashboard.html` (ve gerekirse özel domain)
- [ ] Magic link şablonunda `{{ .ConfirmationURL }}` iki yerde kaldı (buton + düz link)
- [ ] SMTP ile gönderiyorsan Resend’de **domain / sender** doğrulandı mı?

Resend + Supabase SMTP birleşimi için ayrıntı: ana `README.md` içindeki contact / Resend notlarına bak.
