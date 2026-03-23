# ActAware

UK employer compliance alerts: landing pages, Stripe checkout, Netlify Functions (daily digest / quiet-day email), Supabase, Resend, Anthropic.

## Contact, güven & yasal metin

- **`contact.html`** — İletişim formu (Netlify **Forms**, form adı `actaware-contact`). Gönderim **AJAX ile** `POST /` (kök URL) yapılır — `POST /contact.html` çoğu zaman başarısız olur. Başarıda tarayıcı **`/contact-thanks.html`** açılır.
- **Mesajlar nereye gider?** (1) Netlify: **Site → Forms → actaware-contact → Submissions**. (2) E-posta: **`contact-notify.js`** — form `POST /` başarılı olduktan sonra tarayıcı **`/.netlify/functions/contact-notify`** çağırır; **Resend** ile bildirim gider (Netlify’ın `submission-created` olayı çoğu projede tetiklenmediği için bu yol kullanılıyor). Varsayılan alıcı **`alpkohen67@gmail.com`**; **`CONTACT_FORM_NOTIFY_EMAIL`** ile değiştirilebilir. **`RESEND_API_KEY`** gerekli. **Resend** test modunda yalnızca doğrulanmış alıcılara gidebilir — log: Netlify **Functions → contact-notify**. İsteğe bağlı: **`CONTACT_FORM_FROM`** / **`RESEND_FROM`**.
- İlk deploy sonrası **Forms** altında `actaware-contact` görünmüyorsa deploy’u yenile; ücretsiz planda aylık gönderim limiti vardır.
- **`index.html`** — `#trust` (“Who we are”), footer’da şirket unvanı + Companies House linki, genişletilmiş **disclaimer** (bilgilendirme amaçlı, hukuki tavsiye değildir).

## Free trial (14 gün, kart yok)

- **`trial.html`** — Kayıt formu (ad, soyad, iş e-postası, şirket, sektör, rol, şirket büyüklüğü, isteğe bağlı not).
- **`register-trial`** Netlify fonksiyonu — Supabase’e `users` + `subscriptions` (`plan: trial`, `trial_ends_at`) yazar; aynı e-posta ile ikinci trial engellenir (`trial_used_at`).
- **`trial-welcome.html`** — Başarı sonrası yönlendirme.
- **Hoş geldin e-postası:** Başarılı trial kaydından sonra **`register-trial`** Resend ile “trial started” maili gönderir (`RESEND_API_KEY`, `RESEND_FROM` / `CONTACT_FORM_FROM` önerilir).
- **Günlük mail:** `send-alerts-background` aktif abonelikleri çeker; `plan === 'trial'` ve `trial_ends_at` geçmişse o kullanıcıya mail gitmez.

## Üyelik, hesap ve site başlığı

- **`js/auth-header.js`** — Tüm ana sayfalarda `#auth-status`: giriş yoksa **Sign in** + **Free trial**; giriş varsa isim, plan rozeti, **Account**, **My alerts**, **Sign out** (`account-profile` GET ile plan etiketi).
- **`account.html`** — Magic link ile giriş; profil görüntüleme / **PATCH** `account-profile`; trial veya Starter için **Upgrade** linkleri (`register.html?plan=…&upgrade=1`); ödeme yapanlar için **Manage billing** → `create-billing-portal` (Stripe Customer Portal — Dashboard’da etkinleştirilmeli).
- **`account-profile`** — `GET` / `PATCH` + JWT (dashboard ile aynı Supabase doğrulama).
- **`register.html?plan=…&upgrade=1`** — Oturum açıksa form `account-profile` ile doldurulur, e-posta salt okunur; gövdede `upgrade: true` ve `Authorization: Bearer …` ile **`register-and-checkout`** JWT e-posta eşleşmesini doğrular.
- **Ödeme onay e-postası:** **`stripe-webhook`** içinde `checkout.session.completed` sonrası Resend ile “subscription confirmed” gönderilir (`success.html` ile uyumlu).

### Supabase migration (profil + trial kolonları)

SQL Editor’da çalıştırın:

- `supabase/migrations/20260322120000_users_profile_and_trial.sql`

`subscriptions` tablosunda `stripe_customer_id` / `stripe_subscription_id` için **NULL** izni trial satırları içindir. Stripe ödemesi sonrası webhook aynı `user_id` satırını günceller.

### Netlify (isteğe bağlı)

| Değişken | Açıklama |
|----------|-----------|
| `TRIAL_DAYS` | Varsayılan **14**. 1–90 arası güvenli sınır. |
| `CONTACT_FORM_NOTIFY_EMAIL` | İletişim formu bildirimi (Resend). Boşsa **`alpkohen67@gmail.com`** kullanılır. |
| `CONTACT_FORM_FROM` / `RESEND_FROM` | Resend “from” adresi; yoksa `ActAware <onboarding@resend.dev>` (Resend test). Trial / ödeme onay mailleri de bunu kullanır. |

## Ücretli planlar (form → Stripe / Agency mail)

- Fiyat kartları **`register.html?plan=starter`**, **`?plan=professional`**, **`?plan=agency`** adresine gider.
- **`register-and-checkout`** — Profili Supabase `users` tablosuna yazar; **Starter / Professional** için Stripe Checkout URL döner; **Agency** için `mailto:` ile dolu gövde döner (önce kayıt, sonra e-posta istemcisi).
- Fiyat ID’leri `register-and-checkout.js` içinde tanımlı (`PLAN_PRICE_IDS`); Stripe’da değişirsen burayı güncelle.
- Eski `create-checkout-session` silindi; tüm checkout akışı `register-and-checkout` üzerinden.

## Professional / Agency — ürün vaadi vs kod

| Özellik | Durum |
|--------|--------|
| Günlük özet + **genişletilmiş analiz** (severity, governance, timeline, cross-checks) | ✅ `send-alerts-background` — Professional/Agency için ayrı Claude çağrısı (`digestTier: professional`) |
| **24 saat içinde CRITICAL** ek e-posta | ✅ `send-critical-alerts-background` — 2 saatte bir cron, son ~24 saat, yalnız CRITICAL; `sent_alerts` ile 36 saat dedupe |
| **seat_limit** (Starter 1, Pro 3, Agency 15) | ✅ Stripe webhook + migration; çoklu kullanıcı davet UI henüz yok |
| Slack / Teams | ❌ Henüz yok (roadmap) |

## My alerts (`dashboard.html`) — magic link + planlı arşiv

- **Giriş:** Supabase **Email** (magic link / OTP). Kullanıcı abonelikteki e-postayla `signInWithOtp` alır; `dashboard-alerts` yalnızca geçerli **JWT** (`Authorization: Bearer …`) ile çalışır (eski “sadece e-posta gövdesi” kaldırıldı).
- **Arşiv:** **Professional** ve **Agency** + `subscriptions.status === 'active'` → son **500** uyarıya kadar tam geçmiş; **Starter**, **trial**, pasif veya diğer → son **30 gün** ve en fazla **100** kayıt.
- **Netlify fonksiyonları:** `public-config` (GET) tarayıcıya `SUPABASE_URL` + `SUPABASE_ANON_KEY` döner; `dashboard-alerts` JWT’yi anon istemciyle doğrular, sorguları **service role** ile yapar.

### Supabase Auth ayarları

1. **Authentication → Providers → Email** — Magic link / OTP açık olsun.
2. **Authentication → URL configuration** — **Site URL** üretim kökünüz (ör. `https://act-aware.netlify.app`).
3. **Redirect URLs** — `https://…/dashboard.html` ve yerelde test için `http://localhost:8888/dashboard.html` (veya kullandığınız Netlify CLI portu).
4. **E-posta görünümü (ActAware markası)** — Supabase varsayılanı “Supabase Auth” gönderenidir. **HTML şablonları** ve isteğe bağlı **SMTP (Resend)** için: `docs/supabase-auth-email-templates.md`.

### Supabase

- `supabase/migrations/20260324120000_subscriptions_seat_limit.sql` — `subscriptions.seat_limit`

### Netlify

| Değişken | Açıklama |
|----------|-----------|
| `CRITICAL_ALERTS_DISABLED` | `true` ise kritik pulse fonksiyonu hiç çalışmaz (maliyet kesmek için) |

Zamanlama: `netlify.toml` içinde `send-critical-alerts-background` → **`15 */2 * * *`** (UTC, yaklaşık 2 saatte bir).

## Supabase: audit tabloları

`send-alerts-background` fonksiyonu iki tabloya yazar:

| Tablo | Amaç |
|--------|------|
| `raw_feed_logs` | Her feed için, Claude’a gitmeden önce parse edilmiş item’lar (`run_id`, `items_json`) |
| `feed_fetch_errors` | RSS/HTTP hataları (`run_id`, `error_message`) |

### Adımlar (önerilen: SQL Editor)

1. [Supabase Dashboard](https://supabase.com/dashboard) → projenizi seçin.
2. Sol menüden **SQL Editor** → **New query**.
3. Bu dosyaları sırayla açıp yapıştırın ve **Run**:
   - `supabase/migrations/20260321120000_raw_feed_logs_and_feed_fetch_errors.sql`
   - `supabase/migrations/20260322120000_users_profile_and_trial.sql` *(ücretsiz deneme + profil kolonları)*
   - `supabase/migrations/20260323120000_subscriptions_plan_check_trial.sql` *(plan kolonunda `trial` izni — trial kaydı hatası alıyorsan)*
   - `supabase/migrations/20260324120000_subscriptions_seat_limit.sql` *(koltuk limiti)*
   - `supabase/migrations/20260325120000_subscriptions_unique_user_id.sql` *(duplicate temizliği + `user_id` UNIQUE)*
   - `supabase/migrations/20260326120000_digest_snapshots.sql` *(günlük standart özet kopyası — `dashboard.html` boşken son 30 gün)*
4. **Table Editor**’da tabloların oluştuğunu doğrulayın.

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
| `SUPABASE_ANON_KEY` | **Anon (public) key** — `public-config` ve JWT doğrulama için; tarayıcıya gider, gizli tutmanız gerekmez |
| `SUPABASE_SERVICE_KEY` | **Service role** (sunucu tarafı; RLS bypass — client’a vermeyin) |
| `RESEND_API_KEY` | E-posta gönderimi |
| `ANTHROPIC_API_KEY` | Özet üretimi |
| `SITE_URL` | Checkout success / footer linkleri |
| `STRIPE_SECRET_KEY` | Ödeme (checkout + webhook) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook doğrulama |
| `ALERT_EMAIL` | *(Opsiyonel)* Feed hata olunca Resend ile uyarı almak istediğiniz adres |
| `SEND_ALERTS_TEST_RUN` | `true` ise Londra 08:00 kilidini atlar — **sadece manuel test için**; bitince kaldırın |
| `TEST_EMAIL_ONLY` | Örn. `siz@email.com` — mail **yalnızca bu adrese** gider (abonelikte yoksa bile test maili gider; `sent_alerts` yazılmaz) |
| `FORCE_QUIET_DAY_EMAIL` | `true` + **mutlaka** `TEST_EMAIL_ONLY` — RSS/Claude **çalışmaz**, sadece **“all quiet”** (güncelleme yok) mail şablonu gider |

Netlify: **Site settings → Environment variables**

### E-posta testi (güvenli)

1. Netlify → **Environment variables** → ekleyin: `SEND_ALERTS_TEST_RUN` = `true`, `TEST_EMAIL_ONLY` = kendi e-postanız.
2. **Save** → **Deploys** → **Trigger deploy** → **Clear cache and deploy site** (env’nin fonksiyona işlemesi için).
3. **Functions** → `send-alerts-background` → **Invoke function** (veya tarayıcıdan `POST` ile aynı endpoint).
4. Gelen kutunuzu kontrol edin; konu satırında **`[TEST]`** görünür.
5. Test bittikten sonra Netlify’dan **`SEND_ALERTS_TEST_RUN` ve `TEST_EMAIL_ONLY` değişkenlerini silin** (veya `false` / boş), yoksa üretim davranışı bozulur.

### “Güncelleme yok” mailini önizleme

Aynı şekilde şu **üç** değişkeni birden açın: `SEND_ALERTS_TEST_RUN` = `true`, `TEST_EMAIL_ONLY` = sizin adresiniz, **`FORCE_QUIET_DAY_EMAIL`** = `true`. Deploy sonrası fonksiyonu tetikleyin — gelen kutuda **All quiet** konusu ve metin görünür (feed taraması yapılmaz, Anthropic maliyeti yok). Bitince `FORCE_QUIET_DAY_EMAIL`’i de silin.

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

- `index.html`, `trial.html`, `trial-welcome.html`, `register.html`, `account.html`, `dashboard.html`, `success.html`, `contact.html` — arayüz
- `js/auth-header.js` — site geneli oturum rozeti (`#auth-status`)
- `netlify/functions/send-alerts-background.js` — günlük tarama ve mail
- `netlify/functions/register-trial.js` — ücretsiz deneme kaydı + hoş geldin e-postası (Resend)
- `netlify/functions/register-and-checkout.js` — ücretli plan / upgrade (JWT) → Stripe veya Agency mailto
- `netlify/functions/account-profile.js` — profil + plan `GET` / `PATCH` (JWT)
- `netlify/functions/create-billing-portal.js` — Stripe Customer Portal oturumu (JWT)
- `netlify/functions/send-critical-alerts-background.js` — Professional/Agency CRITICAL pulse (~24 saat)
- `netlify/functions/lib/employer-feeds.js` — paylaşılan RSS listesi + fetch/parse
- `netlify/functions/stripe-webhook.js` — Stripe webhook + ödeme onay e-postası (Resend)
- `netlify/functions/dashboard-alerts.js` — alert geçmişi
