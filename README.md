# ActAware

UK employer compliance alerts: landing pages, Stripe checkout, Netlify Functions (daily digest / quiet-day email), Supabase, Resend, Anthropic.

## Supabase: audit tabloları

`send-alerts-background` fonksiyonu iki tabloya yazar:

| Tablo | Amaç |
|--------|------|
| `raw_feed_logs` | Her feed için, Claude’a gitmeden önce parse edilmiş item’lar (`run_id`, `items_json`) |
| `feed_fetch_errors` | RSS/HTTP hataları (`run_id`, `error_message`) |

### Adımlar (önerilen: SQL Editor)

1. [Supabase Dashboard](https://supabase.com/dashboard) → projenizi seçin.
2. Sol menüden **SQL Editor** → **New query**.
3. Bu dosyanın içeriğini açıp yapıştırın ve **Run**:
   - `supabase/migrations/20260321120000_raw_feed_logs_and_feed_fetch_errors.sql`
4. **Table Editor**’da `raw_feed_logs` ve `feed_fetch_errors` tablolarının oluştuğunu doğrulayın.

> Tablolar yoksa fonksiyon çalışırken insert hataları log’a düşer; mail akışı diğer feed’lerle devam edebilir ama denetim/hata kaydı eksik kalır.

### İsteğe bağlı: Supabase CLI

Projeyi `supabase link` ile bağladıysanız:

```bash
supabase db push
```

(Migration dosyaları `supabase/migrations/` altında.)

## Netlify ortam değişkenleri (kontrol listesi)

Background fonksiyon ve diğer lambda’lar için tipik değişkenler:

| Değişken | Kullanım |
|----------|----------|
| `SUPABASE_URL` | Supabase proje URL |
| `SUPABASE_SERVICE_KEY` | **Service role** (sunucu tarafı; RLS bypass — client’a vermeyin) |
| `RESEND_API_KEY` | E-posta gönderimi |
| `ANTHROPIC_API_KEY` | Özet üretimi |
| `SITE_URL` | Checkout success / footer linkleri |
| `STRIPE_SECRET_KEY` | Ödeme (checkout + webhook) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook doğrulama |
| `ALERT_EMAIL` | *(Opsiyonel)* Feed hata olunca Resend ile uyarı almak istediğiniz adres |

Netlify: **Site settings → Environment variables**

## Yerel / deploy

- Statik site kökten yayınlanır; fonksiyonlar `netlify/functions/`.
- Zamanlama: `netlify.toml` içinde `send-alerts-background` için cron + fonksiyon içinde **Europe/London 08:00** kontrolü.

## Proje yapısı (kısa)

- `index.html`, `dashboard.html`, `success.html` — arayüz
- `netlify/functions/send-alerts-background.js` — günlük tarama ve mail
- `netlify/functions/create-checkout-session.js`, `stripe-webhook.js` — abonelik
- `netlify/functions/dashboard-alerts.js` — alert geçmişi
