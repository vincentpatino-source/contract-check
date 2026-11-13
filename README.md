# Your MCA contract checker site: setup guide

This folder is your complete website: a landing page, the contract decoder, the quick estimator, and privacy and terms pages. It runs on **Cloudflare**, whose free plan allows business use. The AI runs through **your own Anthropic API key**, at roughly a few cents to about $0.30 per contract.

Plan on about an hour the first time. A freelancer can do it in 20 minutes if you'd rather hand it off. Send them this file.

---

## 1. Buy your domain at Cloudflare
1. Create a free account at dash.cloudflare.com.
2. Go to **Domain Registration → Register Domains**, search for your name, and buy it. Cloudflare charges about what the registry charges, typically around $10–12 a year for a .com.

Buying the domain at Cloudflare means step 6 is a couple of clicks: no copying DNS records between companies.

## 2. Make your lead form in Tally (free) and send it to Google Sheets
1. Go to tally.so, create a free account, and click **Create form**.
2. Add these fields:
   - Name, Business name, Phone, Email
   - "Tell us about your situation" (long answer)
   - File upload, optional: "Attach your contracts if you'd like us to review them"
   - **Consent checkbox, not pre-checked:** "I agree that [Your Business Name] may contact me by phone call, text message or prerecorded message at the number I provided. Consent is not a condition of any service. Message and data rates may apply. Reply STOP to opt out."
3. Add a **Hidden fields** block (type `/hidden`) with these names, exactly as written:
   `source, entry_point, contracts, funders, weekly_payments, total_owed, advances, monthly_revenue`
   The site fills these in automatically, so you'll see each owner's numbers with the lead.
4. Publish the form. Its link looks like `tally.so/r/AbC123`, and `AbC123` is your **form ID**.
5. In the form, open **Integrations → Google Sheets → Connect**. Every new lead now lands in a Google Sheet as well as your email. Share the sheet with your VA.

## 3. Get an Anthropic API key
1. Go to console.anthropic.com and create an account.
2. Under **Billing**, add a card and buy some credit ($20 goes a long way).
3. **Set a monthly spend limit** (for example $50) so a traffic spike can't run up a bill.
4. Under **API Keys**, create a key and copy it. It starts with `sk-ant-`. Keep it private, and never put it in the website files.

## 4. Edit two settings
Open `app.js`, and at the top change:
```js
tallyFormId: "AbC123",          // from step 2
businessName: "Your Brand",     // shows in the header and footer
phone: "(555) 555-0123",        // optional, shows in the contact section
```
In `index.html`, change the `<title>` and the `[Business address]` in the footer. Fill in the [brackets] in `privacy.html` and `terms.html`, and have your attorney review both.

## 5. Put it online with Cloudflare Pages
1. Create a free account at github.com. Click **New repository**, name it (for example `contract-check`), set it to **Private**, and create it.
2. Click **uploading an existing file** and drag in **everything in this folder**, including the `functions` folder. Click **Commit**.
3. In Cloudflare, go to **Workers & Pages → Create → Pages → Connect to Git**. Connect your GitHub account and pick the repository.
4. In the build settings, choose framework preset **None**, leave the build command **empty**, and set the output directory to `/`. Click **Save and Deploy**.
5. When it finishes, open the project's **Settings → Variables and Secrets** and add, for **Production**:
   - `ANTHROPIC_API_KEY`: your key from step 3. Choose type **Secret** so it stays hidden.
   - `ALLOWED_ORIGINS`: `https://yourdomain.com,https://www.yourdomain.com`
6. Go to **Deployments**, open the latest one's **⋯** menu and click **Retry deployment** so it picks up the key. You'll get a test address like `contract-check.pages.dev`. Open it and check one real contract.

## 6. Connect your domain
1. In your Pages project, open **Custom domains → Set up a custom domain** and enter `yourdomain.com`. Because the domain is already on Cloudflare, it adds the DNS record for you.
2. Do the same for `www.yourdomain.com`.
3. It usually goes live within minutes, and the security certificate (https) is automatic.

## 7. Add your tracking tags (optional)
Paste your Google tag (and the Meta Pixel, if you use one) where the comments say so in the `<head>` of `index.html`, then upload the changed file to GitHub. Cloudflare redeploys on its own.

---

## Making changes later
Edit a file on GitHub (click it, then the pencil icon) and commit. Cloudflare republishes in about a minute.

## What's in this folder
| File | What it is |
| --- | --- |
| `index.html` | The landing page |
| `app.js` | Decoder, quick estimator and lead form logic (settings at the top) |
| `schedule.js` | Payment-date rules: next business day for daily, the following week's payday for weekly, double payment after bank holidays, reverse-consolidation disbursements |
| `styles.css` | The look |
| `functions/api/analyze.js` | Server code that sends a contract to Claude using your private key and returns the review |
| `privacy.html`, `terms.html` | Templates. Fill in the brackets and get them reviewed |

## If something goes wrong
- **"The site isn't set up yet: missing API key"**: the secret from step 5 is missing, or you didn't retry the deployment after adding it.
- **"Not allowed"**: `ALLOWED_ORIGINS` doesn't exactly match your domain, including `https://`.
- **Scanned contracts (photos or image PDFs) fail while text PDFs work**: the free plan gives the server very little processing time per request, and large page images can go over it. Upgrade to **Workers Paid ($5 a month)** under Workers & Pages → Plans. Nothing else changes.
- **Different AI model**: add a variable `ANTHROPIC_MODEL` with the model name, then retry the deployment.
- **Costs**: domain about $10–12 a year, Cloudflare $0 (or $5 a month if you need the upgrade above), Tally $0, and AI usage of a few cents to about $0.30 per contract, capped by the spend limit you set in step 3.
