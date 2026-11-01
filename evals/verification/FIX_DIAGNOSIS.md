# Fixed-store findings: extraction errors, not missed store fixes

The historical score-63 run saved only a summary in memory, not its after-journey/findings. Its after-audit UUID does not exist in Supabase. The exact historical list cannot be recovered or inferred from its score.

A fresh real UI/Supabase audit of **the same published PR #1 commit**, `e55f4a9b08197b44b3556bb950ac7297f30ed567`, is `b8eab4e7-a75b-4ab2-9b42-540744e25dfe`. It scored 55 at ₹499 and retained exactly these three findings:

| Finding | Exact evidence | Diagnosis |
| --- | --- | --- |
| Basket sneaking | Cotton Crew Tee — ₹499 | False positive: the agent clicked Add to cart, but the model omitted `product_added`, leaving `items_added_by_agent` empty. |
| Basket sneaking | Order Protection (₹49): covers loss in transit — ₹49 | False positive: the model included an unchecked optional offer as an order item. DOM checks show the checkbox false, no protection in review, and final total ₹499. |
| Subscription trap | Start ChalakPlus 7-day free trial: ₹0 today Renews at ₹199/month after 7 days unless cancelled. — ₹0 | False positive: the model included the unchecked optional trial as an order item. DOM checks show false, clear renewal terms, and no trial in review. |

The new local Codex fix's initial persisted re-audit `0d1a31a8-5b8f-432c-973d-039a31544a1e` also had these three error classes. Its full journey is retained in the resumed UI verification JSON.

## Correction and control

Jhol now records a successful explicit Add to cart action when the model omits the product name. Unchecked offers stay visible to the model but are excluded from order items unless an independent charge row confirms them. Checked extras and actual charge rows remain evidence. Native open dialogs are captured, and popup evidence comes from the current DOM rather than model history. The detector code and JourneyResult contract are unchanged.

Build, 18 core tests and 11 API e2e tests pass. Browser regression tests cover unchecked offers, separately charged items, checked trials, compact markup and native dialogs. Existing detector tests still catch the planted paid/preselected extras.

**One fresh UI control audit**, `89ba68e3-bb3d-4c56-814d-da706f5a472c`, used the unchanged published store code and corrected Jhol extraction: **100/100, ₹499 → ₹499, payment reached, zero findings**. Its complete journey and findings are in [corrected-pr-reaudit.json](corrected-pr-reaudit.json). The existing PR receipt now points to that persisted control audit; older audits remain intact. [Corrected receipt](corrected-pr-receipt.png).

No missed Codex fix was established, so the fix prompt was not changed and Codex was not rerun for this diagnosis. This is a one-session control; urgency removal was also checked directly in the published code/DOM. The original store's two-session eval measures urgency separately.
