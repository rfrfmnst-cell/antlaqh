# Saudi individual opt-in (consent-first)

New public form: `/subscribe/`. It does **not** scrape private numbers, enumerate WhatsApp users, import contacts, or send marketing campaigns.

## Production checklist
1. Ensure the website's privacy notice identifies the controller, purposes, retention, withdrawal process, and contact point.
2. Configure Twilio Verify credentials in the private hosting environment: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`. Never commit secrets.
3. Test the OTP process and abuse/rate limits. Review Twilio charges.
4. Set `INDIVIDUAL_OPTIN_ENABLED=true` **only** when approved; the default is off.
5. Deploy the Node application (not static files alone); use persistent private DB storage and HTTPS.
6. Test a consenting person using the form, and that invalid OTP does not create a verified subscriber.
7. Configure a reliable withdrawal workflow and a separate secure export/sync to Zoho and Google Sheets before running campaigns. Those integrations are not included in this pull request.

A correctly formatted number is not proof of ownership. Only a successful OTP sets `status=verified` and `consent.verifiedAt`. The mobile carrier is self-reported, not inferred from prefix. SMS verification does not itself prove the number has an active WhatsApp account: that field is self-reported.

Status: code prepared for review; not deployed. No actual individual lead records added.
