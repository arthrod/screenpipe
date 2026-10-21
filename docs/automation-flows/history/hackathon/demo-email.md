# Demo bug email (scripted, validated)

Send it on stage from the sender account to `servicedesk.novadesk@gmail.com`
(Gmail "Undo Send" set to 5 s on the sender account). Copy the subject and the
body exactly: this text passed the 20-run AI check (see the table at the end).

**Subject:** NovaCRM creates the same customer twice when the email already exists

**Body:**

```
Hello support team,

Since this morning, NovaCRM creates a duplicate customer record whenever we
add a contact whose email address is already used by an existing customer.

Steps to reproduce:
1. In NovaCRM, open Customers and click "New customer".
2. Enter a name and an email address that already belongs to an existing
   customer (for example anna.berg@example.com).
3. Click "Save".

Expected result: NovaCRM warns that a customer with this email already exists
and offers to open the existing record, without creating a new one.

Actual result: no warning is shown and a second customer is created with the
same email address. The two records now have separate histories, and our
reminder emails go out twice.

This happens for the whole sales team, about ten times a day. For now we
search for the email before every creation, which slows us down a lot.

Best regards,
Nils Laeremans
Sales Manager
```

## 20-run AI check (18 Oct, `chatgpt/gpt-5.6-luna:low`, 20/20)

Same system prompt, schema and model as the workflow, sent directly to the
local proxy (`:3030/v1/chat/completions`), no Jira. A run passes when it is
Bug, NovaCRM, confidence high, every section filled (no « Not stated » in
reporter, description, expected, actual, impact), at least 3 steps, the
reporter names Nils Laeremans, Sales Manager, and the summary is ≤ 80 chars.
A first prompt version scored 7/20 (the reporter came back « Not stated »,
priority drifted); the fixed prompt scored:

| # | ms | type | product | confidence | priority | label | summary | steps/leads/criteria | result |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 3819 | Bug | NovaCRM | high | High | back | Duplicate customers created for existing email addresses | 4/3/4 | pass |
| 2 | 4010 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 3 | 3496 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 4 | 3688 | Bug | NovaCRM | high | High | back | Duplicate customers allowed for existing email addresses | 4/3/4 | pass |
| 5 | 4021 | Bug | NovaCRM | high | High | back | Duplicate customer created for an existing email address | 4/3/4 | pass |
| 6 | 4296 | Bug | NovaCRM | high | High | back | Duplicate customers created for existing email addresses | 4/3/4 | pass |
| 7 | 4299 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 8 | 3281 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 9 | 5454 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 10 | 3759 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 11 | 3700 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 12 | 4540 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 13 | 3816 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 14 | 3672 | Bug | NovaCRM | high | High | back | Duplicate customers created for existing email addresses | 4/3/4 | pass |
| 15 | 3914 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 16 | 4158 | Bug | NovaCRM | high | High | back | Duplicate customers can be created with an existing email address | 4/3/4 | pass |
| 17 | 4207 | Bug | NovaCRM | high | High | back | Duplicate customer records created for existing email addresses | 4/3/4 | pass |
| 18 | 3957 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 19 | 4789 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
| 20 | 4192 | Bug | NovaCRM | high | High | back | Duplicate customer created when email already exists | 4/3/4 | pass |
