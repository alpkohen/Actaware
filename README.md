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
| `SEND_ALERTS_TEST_RUN` | `true` ise Londra 08:00 kilidini atlar — **sadece manuel test için**; bitince kaldırın |
| `TEST_EMAIL_ONLY` | Örn. `siz@email.com` — mail **yalnızca bu adrese** gider (abonelikte yoksa bile test maili gider; `sent_alerts` yazılmaz) |

Netlify: **Site settings → Environment variables**

### E-posta testi (güvenli)

1. Netlify → **Environment variables** → ekleyin: `SEND_ALERTS_TEST_RUN` = `true`, `TEST_EMAIL_ONLY` = kendi e-postanız.
2. **Save** → **Deploys** → **Trigger deploy** → **Clear cache and deploy site** (env’nin fonksiyona işlemesi için).
3. **Functions** → `send-alerts-background` → **Invoke function** (veya tarayıcıdan `POST` ile aynı endpoint).
4. Gelen kutunuzu kontrol edin; konu satırında **`[TEST]`** görünür.
5. Test bittikten sonra Netlify’dan **`SEND_ALERTS_TEST_RUN` ve `TEST_EMAIL_ONLY` değişkenlerini silin** (veya `false` / boş), yoksa üretim davranışı bozulur.

## Kaynakların tamamının taranması (güvence)

`send-alerts-background.js` içinde **12 adet** RSS/Atom kaynağı (`RSS_FEEDS`) tanımlıdır; her çalıştırmada **hepsi sırayla denenir** (biri çökse diğerleri devam eder).

### Nasıl doğrularsınız?

1. **Netlify** → site → **Functions** → `send-alerts-background` → son çalıştırmanın **Response body** JSON’una bakın:
   - `feedOutcomes`: her kaynak için `status` (`in_digest`, `no_items_in_window`, `claude_no_employer_relevant`, `fetch_or_parse_error`, `claude_error`)
   - `summary`: kaç kaynak özetlendi, kaçında hata var, vb.
2. **Supabase** → `raw_feed_logs`: aynı `run_id` ile 12 satır görürsünüz (her kaynak bir satır; `item_count` o pencerede kaç item olduğunu gösterir).
3. **Supabase** → `feed_fetch_errors`: sadece gerçek hata olduğunda satır oluşur (HTTP timeout, Anthropic hata mesajı `Anthropic: ...` ile başlayabilir).

### Bilerek uygulanan sınırlar (atlanma değil, tasarım)

| Durum | Açıklama |
|--------|-----------|
| **Son ~36 saat** | Günlük mail için sadece bu penceredeki **tarihli** item’lar işlenir; tarihi olmayan atom öğeleri günlük tekrarı önlemek için **alınmaz**. |
| **Legislation.gov.uk** | Tüm SI’lar değil; başlık/özetinde iş/çalışan ile ilgili anahtar kelimelerden **biri** geçenler tutulur (geniş liste; yine de “employment” dışı SI’lar bilerek dışarıda kalabilir). |
| **Claude “işveren için yok”** | Model, verilen item’lar için `No employer-relevant updates...` dönerse o kaynak **günlük özet mailine girmez**; ham veri yine `raw_feed_logs`’ta kalır. |

Bu sınırlar dışında, fetch/parse hatası olursa kayıt **`feed_fetch_errors`** tablosuna yazılır.

## Yerel / deploy

- Statik site kökten yayınlanır; fonksiyonlar `netlify/functions/`.
- Zamanlama: `netlify.toml` içinde `send-alerts-background` için cron + fonksiyon içinde **Europe/London 08:00** kontrolü.

## Proje yapısı (kısa)

- `index.html`, `dashboard.html`, `success.html` — arayüz
- `netlify/functions/send-alerts-background.js` — günlük tarama ve mail
- `netlify/functions/create-checkout-session.js`, `stripe-webhook.js` — abonelik
- `netlify/functions/dashboard-alerts.js` — alert geçmişi
