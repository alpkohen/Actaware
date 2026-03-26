# Canlıya geçiş — kısa kontrol listesi

**Not:** Bu adımları yalnızca sen yapabilirsin (Stripe / Netlify şifreleri sende). Aşağıdaki sırayı üstten alta işaretle.

---

## Adım 1 — Stripe (Live mod)

1. [ ] Stripe’da sağ üstten **Test mode’u kapat** → **Live** aç.
2. [ ] Panelde kırmızı/uyarı varsa **hesabı tamamla** (işletme doğrulama vb.).
3. [ ] **Ürünler → Fiyatlar:** Starter, Professional, Agency için **aylık abonelik fiyatı** oluştur (testtekilerin aynısı olabilir, ama **Live** ekranında).
4. [ ] Her planın **Price ID**’sini bir yere kopyala (`price_...` — üç tane).

---

## Adım 2 — Netlify (sadece Production)

**Site → Site configuration → Environment variables →** aşağıdakileri **Production** için güncelle:

| Değişken | Değer |
|----------|--------|
| `STRIPE_SECRET_KEY` | `sk_live_...` (Live API keys’ten) |
| `STRIPE_PRICE_STARTER` | Live `price_...` (Starter) |
| `STRIPE_PRICE_PROFESSIONAL` | Live `price_...` (Professional) |
| `STRIPE_PRICE_AGENCY` | Live `price_...` (Agency) |
| `STRIPE_WEBHOOK_SECRET` | Adım 3’te alacağın `whsec_...` |
| `SITE_URL` | `https://actaware.co.uk` |

5. [ ] Kaydet → **Deploys → Trigger deploy → Clear cache and deploy site** (veya boş commit + `git push`).

---

## Adım 3 — Stripe webhook (Live)

1. [ ] Stripe **Developers → Webhooks → Add endpoint**
2. [ ] URL: `https://actaware.co.uk/.netlify/functions/stripe-webhook`
3. [ ] Dinlenecek olaylar: **checkout.session.completed**, **customer.subscription.updated**, **customer.subscription.deleted**
4. [ ] Oluştur → **Signing secret**’ı kopyala → Netlify’da `STRIPE_WEBHOOK_SECRET` olarak yapıştır → tekrar deploy.

---

## Adım 4 — Supabase (bir kere)

1. [ ] **Authentication → URL configuration**
2. [ ] **Site URL:** `https://actaware.co.uk`
3. [ ] **Redirect URLs** içine ekle:  
   `https://actaware.co.uk/dashboard.html`  
   `https://actaware.co.uk/reset-password.html`  
   (www kullanıyorsan `https://www.actaware.co.uk/...` aynı şekilde.)

---

## Adım 5 — Son kontrol

1. [ ] Stripe **Settings → Billing → Customer portal** açık (Manage billing için).
2. [ ] Siteden küçük bir **gerçek** ödeme dene → Stripe’da ödeme görünsün, Netlify **Functions → stripe-webhook** logunda hata olmasın.

---

## Hatırlatma (tek cümle)

**Live anahtar (`sk_live_`) = Live fiyat ID’leri = Live webhook sırrı.** Hepsi aynı “canlı” dünyada olmalı; testtekileri karıştırma.
