import {selfServiceGuide} from './self-service-guide.mjs';
export function englishUsageGuide(version){return selfServiceGuide('en')+String.raw`Quality Workbench ${version} - English user guide

Getting started

1. Install the complete Windows x64 package. The installer offers English and Simplified Chinese. Node 24, Java 21 and the Spring AI worker are included; no development environment is required. Open "Start Quality Workbench.exe". Use "Stop Quality Workbench.exe" to stop the service; closing the browser does not stop it.

2. Select English or Chinese in the workbench header. The preference is saved in this browser. Changing interface language does not call a model or change existing records, rules, time calculations or review decisions.

3. Configure the approved OpenAI-compatible model endpoint, exact model ID and authentication mode in Model Settings. A gateway that does not require a key can use no-key mode. Save settings, then explicitly test the connection. A connection test makes a real request. Keys are encrypted for the current Windows account and are not included in this package or reports. Configure them again on a different computer or Windows account.

Preparing and inspecting a task

4. Check the published rules and policies assigned to the selected scenario. If absent, import a filled template or create a draft manually, verify it and publish. AI-assisted rule extraction only creates candidates. Bundled directory seeds initialize only a workspace that does not exist; existing workspaces are never overwritten or topped up. Package metadata discloses whether a seed and example are included. Create a task, upload the workbook, verify mapping and completeness, choose effective rule versions, then start AI inspection after a successful connection test.

5. Each conversation is inspected independently. Large files are scheduled in bounded segments; a segment is not a separate business task. The full task can take more than five minutes, while the configured timeout applies to each model request. The default timeout is 120 seconds and can be set from 1 to 290 seconds. Reasoning effort and output limits depend on the approved gateway.

6. For new-policy tasks, valid AI-final PASS is exempt; FAIL, UNCERTAIN and returned records require current human review. Review original messages and frozen references before confirming, and keep both result sources visible. Older tasks without a frozen policy retain the original review behavior. A failed request is an incomplete check, not a failed quality finding. Pending judgments and NA (not applicable) remain distinct. The reviewer name is an operation label; this standalone tool does not authenticate corporate identities.

Working with translated content

7. Fixed menus and controls switch language immediately. Business text keeps its original version. Use the business-content translation action to request an English view of rules, policies or inspection reasons. Translation uses the model already configured in this workbench and has separate progress, pause, resume and retry controls. English translation results and reused results are checked for added non-English passages; English sources are preserved. Invalid legacy translations are marked missing and require an explicit retry or regeneration. This language check does not establish semantic translation accuracy. Failed or missing translations are identified explicitly. Translating a view never overwrites the source or changes a decision.

8. In Business Deliverables, select the task, final-decision policy and English report language. Generate the base analysis and the English content translation. For an existing completed base report, use "Generate English view" to translate that saved snapshot. Opening the export page, changing language or downloading saved partial results does not start a new model job. Download the Excel details and the single-file HTML report from the same frozen results. The HTML needs no external assets. Retries preserve completed work; a changed source or report requires the matching translation rather than a stale result.

9. Original field headers, values and physical rows are retained. New ecommerce tasks retain all 23 system columns plus any extensions, and add separate comment/reply translations, quality results and audit sheets. No historical human quality columns are generated for new inputs. Column counts depend on the source and frozen template. Translation never overwrites source cells.

10. The standard ecommerce input is the business-system export with 23 headers on row 1 and data starting on row 2. No criteria row is required. Standard files pass local inspection directly; only changed or older formats need AI-assisted column matching and human confirmation. Follow-up fields are preserved but are not inspected yet. Sentiment flags remain source references, not human quality answers. AI classification supplies the evaluation type for review. Operator codes identify the site; a batch fallback fills only unrecognized sites.

Creating another scenario

11. Daily users select one of the two built-in scenarios, upload the source workbook, verify the preview and set run parameters. Administrators manage scenario capabilities and templates separately. AI-drafted new scenarios require human verification before publication.

12. Product consultation includes 14 intent classes, selection principles and bilingual examples. Sales stage is derived from the intent parent. Scenario publication binds concrete rule versions. The eight probing exceptions and after-sales retention exception are included. Missing knowledge remains explicitly uncertain; product specifications must not be invented from examples.

Time rules and reporting policy

13. Current built-in ecommerce timing uses elapsed natural hours, including nights and weekends, from the comment to the first reply or inspection time if unreplied. Historical tasks retain their original elapsed or working-hours settings and calendars. Language switching does not change UTC+08:00 timestamp interpretation, thresholds or frozen rules.

14. After installing the new published product-consultation scenario, any child Fail yields overall Fail; otherwise judged combinations of Pass, NA and Unable to determine yield Pass. An overall Pass with uncertain children carries a separate count in Excel and HTML. Pending execution or human confirmation is not represented as a completed Pass. Old tasks keep their frozen aggregate policy. Human-confirmed decisions retain precedence; source sentiment flags are never automatically a calibration gold standard.

Operation and upgrades

15. Before upgrading, stop the old service and back up the entire data directory. The default is %LOCALAPPDATA%\MSSQualityWorkbench\portable; DEMO_DATA_DIR can select an existing custom directory. Preserve original sources, workspace data, catalogs, review history, model settings, workflow traces, report jobs and translation caches together. Reinstalling or uninstalling the application keeps external data. One data directory has one active writer.

16. The default workbench port is 4186 and the Java worker uses 4192. Set DEMO_PORT and WORKBENCH_WORKER_PORT to distinct available ports if necessary. Start and stop with the same data and port settings. The tool only manages its own instance, not unrelated Node or Java processes. If checkpoint storage fails, generation pauses and keeps saved results for recovery.

17. Use approved model services for business materials. Translation, summaries, intent classification and improvement suggestions are model-assisted and need human verification. Engineering checks with controlled local responses do not establish translation accuracy or business quality in the enterprise environment. Importing rule text does not create a new algorithm or external-system integration.

18. Chinese and English HTML reports for ecommerce, product consultation and configured conversations now share a dark-blue layout: metadata banner, large KPI cards, inline AI/final rate bars, single-column cases, improvement cards, VOC labels and Notes. Each export remains one offline, print-ready file. Counts, case selection, evidence, conclusion policy, translation status and Excel columns are unchanged. Download a saved report again to apply the new layout; changing presentation does not require a model rerun. Previously downloaded HTML files are not rewritten.

19. Comparison blocks now have a default total of three attempts; individual row requests retain two. Retries include bounded validation feedback. Complete JSON surrounded by explanatory text and redundant equivalent IDs can be normalized, but missing coverage, invalid pairs and invalid references still prevent publication. Exhausted comparisons remain incomplete and can be retried without rerunning successful rows. Workflow traces retain each attempt and safe validation diagnostics. Without a bound intent taxonomy, the program owns the missing-taxonomy label and empty reference even if the model omits or invents intent fields; other analysis remains independently validated. Bound taxonomy labels and references remain strict.

20. Multi-turn import previews show the source role column, source-to-target role mapping, counts and message examples. Verify the actual speakers. Duplicate source-role keys must be corrected. A single source value that mixes customer and agent messages cannot be fixed by reversing the whole mapping; obtain sender identity/direction or correct individual source rows. The conversation owner is not necessarily the speaker of each message.

21. Structured conversation reports use customer-role quotations by default. With unreliable source roles, explicitly select the temporary conversation-evidence mode with unverified speaker roles; quotations must occur literally in a real source turn. Raw direct inspection reports instead anchor quotations in archived original cells and retain unverified speaker attribution without fabricating turns. Chinese and English outputs identify these as review leads, not confirmed customer quotations. Unclear attribution affecting a rule remains Unable to determine. Neither mode repairs earlier sources or decisions. After correcting a source, create a new task and rerun inspection/reporting; historical records remain. Changing scope requires a matching new report snapshot rather than relabeling a saved result.

22. Product-consultation analysis uses explicitly quoted VOC category values and checks sentiment against VOC scope. A retry receives the previous field-level validation feedback; the corrected result must still pass the original evidence, role, enumeration and scope checks. For an existing 0.9.3 report with missing analysis, keep the same evidence scope and use Retry missing items. Only failed nodes run again; completed analysis, translations and issue clusters remain. Upgrading does not call the model automatically. A result the model does not correct remains missing with its diagnosis rather than being marked successful.

Package metadata, file hashes and licenses are included. The Windows package is unsigned. A Chinese guide is also provided.
`}
