# Complete ChronosOps Test Plan

## Document Information

| Field           | Value                     |
| --------------- | ------------------------- |
| Document Type   | Test Plan                 |
| Version         | 1.0                       |
| Status          | Final                     |
| Last Updated    | February 2026             |

---

## Quick Reference

| Test Scenario                                                                                    | Estimated Time | Difficulty |
| ------------------------------------------------------------------------------------------------ | -------------- | ---------- |
| [Test 1: Standard API Generation](#test-1-standard-api-generation)                                  | 10-15 minutes  | Easy       |
| [Test 2: Manual Incident Investigation](#test-2-manual-incident-investigation)                      | 5-10 minutes   | Easy       |
| [Test 3: Flaky App with Self-Healing Evolution](#test-3-flaky-app-with-self-healing-code-evolution) | 15-25 minutes  | Medium     |
| [Test 4: Fault Injection Endpoints](#test-4-fault-injection-endpoints-for-remediation-testing)      | 10-15 minutes  | Medium     |
| [Test 5: Prompt Injection Testing Mode](#test-5-prompt-injection-testing-mode)                      | 15-20 minutes  | Advanced   |
| [Test 6: Manual Code Evolution](#test-6-manual-code-evolution)                                      | 10-15 minutes  | Easy       |
| [Test 7: Rollback via Introduced Bug](#test-7-rollback-via-introduced-bug)                          | 15-20 minutes  | Medium     |

---

## Prerequisites

### Accessing ChronosOps

1. **Web UI**: Open browser to the ChronosOps web application URL
2. **Verify Connection**: Look for the green "Connected" status in the header

### System Health Check

Before testing, verify all systems are operational:

1. Navigate to **Command Center** (home page)
2. Confirm the **System Health** panel shows:
   - ✅ API Server: Connected
   - ✅ WebSocket: Connected
   - ✅ Vision Service: Running
   - ✅ Kubernetes: Connected

---

## Quick Test: For Code Evolution Demonstration With Pre-Deployed App

1. Go to **Development Dashboard**
2. Click on any **User Management API with simulated failure rate** app
3. CLick on **"Open API Docs"**
4. Execute the **GET /users** endpoint multiple times to see random 500 errors
5. Navigate to **Command Center** and watch for the error rate spike and incident creation
6. Click on the incident and watch the investigation identify the root cause and trigger code evolution to fix the bug
7. Confirm the app recovers and no more 500 errors occur after the evolution


---

## Test 1: Standard API Generation

**Objective**: Verify that ChronosOps can autonomously generate, build, deploy, and verify a complete REST API from a natural language requirement.


### Step 1.1: Open Development Dashboard

1. Click **"Development Dashboard"** in the navigation
2. You should see the development cycles list (may be empty initially)

### Step 1.2: Create New Development Cycle

1. Click the **"+ New Cycle"** button (top right)
2. The "New Development Cycle" modal will appear

### Step 1.3: Enter Requirement

Copy and paste one of the requirements from the options above into the text field.

#### Available Test Cases

ChronosOps can generate various types of APIs. Choose any one of the following requirements to test different capabilities of the system:

##### A: Basic Product CRUD API with Pagination ✅ (Recommended for first test)

```
Create a REST API for managing products with CRUD operations for create, read, update, delete, and list product records with pagination support
```

##### B: Authentication & Session Logic ✅

```
Build a REST API for user authentication with registration, login, logout, and session validation endpoints
```

##### C: Validation & Error Handling ✅

```
Generate a REST API for submitting contact forms with input validation and error handling
```


##### D: Basic User CRUD Operations: ✅

```
Create a REST API for managing users with CRUD operations for create, read, update, delete, select and list user records with pagination support
```


##### E: Data Relationships: ✅

```
Design a REST API for projects and tasks, where tasks belong to projects and support CRUD operations.
```


#####  F: Search Functionality: ✅

```
Create a REST API for managing an e-commerce product catalog that supports searching products by name, category, and price range.
```

##### G: Complex Workflow Operations ✅

```
Create a REST API for incident response with endpoints for triggering, resolving, and auditing incidents.

```

> **Note**: Option A is recommended for the first test as it demonstrates standard CRUD operations. Options B and C can be used to test additional capabilities.

### Step 1.4: Start the Cycle

1. Click **"Start Development"**
2. Watch the cycle progress through all 7 phases:

| Phase               | Description                                | Expected Duration |
| ------------------- | ------------------------------------------ | ----------------- |
| **ANALYZING** | Gemini parses the requirement              | 30-60 seconds     |
| **DESIGNING** | Architecture design with Thought Signature | 1-2 minutes       |
| **CODING**    | TypeScript code generation (10-15 files)   | 2-4 minutes       |
| **TESTING**   | Vitest test suite execution                | 30-60 seconds     |
| **BUILDING**  | Docker image build with Kaniko             | 2-3 minutes       |
| **DEPLOYING** | Kubernetes deployment                      | 30-60 seconds     |
| **VERIFYING** | Health checks and endpoint verification    | 30-60 seconds     |

### Step 1.5: Verify Completion

1. The cycle status should change to **"COMPLETED"** (green)
2. Click **"Open Live App"** to see the running application
3. Open the **/docs** endpoint in the browser to access the Swagger/OpenAPI documentation

### Step 1.6: Test the Live API

1. In the API docs page, expand any **GET** endpoint (e.g., `/products`, `/users`, `/contacts`)
2. Click **"Try it out"**
3. Click **"Execute"**
4. Verify you receive a `200 OK` response

**Expected endpoints by option:**

| Option           | Key Endpoints to Test                                                |
| ---------------- | -------------------------------------------------------------------- |
| Option A (CRUD)  | `GET /products`, `POST /products`, `GET /products/{id}`        |
| Option B (Auth)  | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout` |
| Option C (Forms) | `POST /contacts`, `GET /contacts`, validation error responses    |

### Expected Outcome

✅ Application deployed successfully
✅ All tests passed (7/7 or similar)
✅ API docs accessible and functional
✅ Endpoints return expected responses

### Troubleshooting

| Issue                             | Solution                                          |
| --------------------------------- | ------------------------------------------------- |
| API docs page shows 502/503 error | Wait 30 seconds for pod to be ready, then refresh |
| API docs page doesn't load at all | Delete the cycle and create a new one             |
| Cycle stuck at BUILDING           | Check if container registry is accessible         |
| Cycle fails at TESTING            | Review the test output in cycle details           |

---

## Test 2: Manual Incident Investigation

**Objective**: Verify that ChronosOps can investigate manually-created incidents using the OODA loop.

### Step 2.1: Navigate to Command Center

1. Click **"Command"** in the navigation
2. This is the main real-time monitoring dashboard
3. Select the Contact Forms Submission API application from the Monitoring list (or any deployed app from Test 1)

### Step 2.2: Create a New Incident

1. Click the **"+ Report Incident** button below the monitoring graph
2. Fill in the incident details:

| Field       | Value                                                                                  |
| ----------- | -------------------------------------------------------------------------------------- |
| Title       | `High Spike in Latency`                                                          |
| Description | `High spike has observed in contacts form submission  api`                   |
| Severity    | `Medium` because system is healthy but degraded performance is assumed from graph observation   |
| Application | `contact-form-submission-rest-api....` select the correspondign application under observation |
| Start AI Investigation immediated | Mark the checkbox to start the OODA loop immediately after reporting |

3. Click **"Create Incident"** this should create the incident, redirect you to the incident details view and start the investigation automatically

### Step 2.3: Start Investigation
If you are not automatically redirected to the incident details view after creating the incident, you can manually start the investigation by following these steps:
1. From the Command center Scroll down and Locate the newly created incident in the list
2. Click the **"Investigate"** button on the incident card to open the details
3. The investigation will begin automatically if not then click the start investigation button to initiate the OODA loop process

### Step 2.4: Monitor the OODA Loop

In the incident details Watch the investigation progress through the phases:

| Phase               | What to Observe                                    |
| ------------------- | -------------------------------------------------- |
| **OBSERVING** | AI collects evidence (video frames, metrics, logs) |
| **ORIENTING** | Timeline builder correlates all evidence           |
| **DECIDING**  | Hypotheses generated with confidence scores        |
| **ACTING**    | Remediation action selected and executed           |
| **VERIFYING** | System re-analyzed to confirm fix                  |
| **DONE**      | Investigation complete, postmortem generated       |

### Step 2.5: Review Results

In the incident investigation view
1. Review the **Evidence** panel (view the collected evidence - video frames, metrics, logs)
2. Review the **Hypotheses** panel (AI-generated root cause theories)
3. Review the **Actions** log (remediation attempts)
4. View the **Postmortem Report** (auto-generated documentation)

### Expected Outcome

✅ Investigation completes with status "DONE"
✅ At least one hypothesis generated with confidence score
✅ View the collected evidence (video frames, metrics, logs)
✅ View the investigation timeline showing the sequence of events and actions taken
✅ View the valid planned remediation actions that executed (e.g., Restart, Scale)
✅ Postmortem report is available after the incident
✅ Verify that the learned patterns are generated in the `Intelligence` section
---

## Test 3: Flaky App with Self-Healing Code Evolution

**Objective**: This is the **key demonstration** of ChronosOps' unique capability of autonomous code evolution to fix production bugs.

### Step 3.1: Configure Prompt Injection Testing (REQUIRED)

> ⚠️ **IMPORTANT**: This setting must be enabled for the flaky app to pass initial verification.

1. Navigate to **Setup** page
2. Click on **"Development Settings"** card
3. Enable **"Enable Prompt Injection Testing"** toggle (orange)
4. Click **"Save Settings"**

This setting bypasses 500 errors during initial verification when the requirement contains the phrase "production bug that needs to be fixed".

### Step 3.2: Create the Flaky Application

1. Navigate to **Development Dashboard**
2. Click **"+ New Cycle"**
3. **Copy and paste this EXACT requirement**:

```
Create a REST API for managing users with CRUD operations. Include a subtle bug in the GET /users endpoint: randomly return 500 Internal Server Error for about 50% of requests by throwing an error when Math.random() < 0.5 This simulates a production bug that needs to be fixed.
```

> ⚠️ **CRITICAL**: The phrase "production bug that needs to be fixed" must be present for the verification bypass to work.

4. Click **"+Create Backend"**

5. In the development open the App development cycle details and click **"Start Cycle"** to begin the development process

### Step 3.3: Wait for Deployment to complete

1. Monitor the cycle as it progresses through all phases *ANALYZING → DESIGNING → CODING → TESTING → BUILDING → DEPLOYING → VERIFYING*
2. Due to the random 500 error, the Cycle phases may need multiple Iterations and may fail at Verifying, but if Prompt Injection Testing is enabled, it will bypass the error and eventually complete successfully.
3. If the cycle fails repeatedly at VERIFYING:
   - Cancel the cycle
   - Delete the app
   - Create a new cycle (the randomness may pass next time)

### Step 3.4: Verify the Bug Exists

Once deployed:

1. Click **"Open Live App"** to access the running application
2. Open the OpenAPI /docs endpoint `https://<chronosopsUrl>/apps/<generatedAppUrl>/docs` in the browser
3. Locate the **GET /users** endpoint
4. The endpoing description should mention "simulated failure"
5. Click **"Try it out"** then click → **"Execute"**
6. Click the **Execute multiple times** (10-30 times)
7. You should see approximately 25% of requests return `500 Internal Server Error`

### Step 3.5: Generate Traffic to Trigger Detection

1. **Continue executing the endpoint repeatedly** (50+ times)
2. This generates error traffic that accumulates in the monitoring system
3. The error rate should spike above the 5% detection threshold to trigger the incident creation

### Step 3.6: Monitor for Automatic Incident Detection

1. Navigate to **Command Center**
2. Select the application from the monitoring list
3. Watch the monitoring graph for the deployed application
4. When the error rate exceeds 5%, in less that 1 minute an **incident will be automatically created**
5. The investigation will start automatically
6. Select the view incident from the notification to watch the investigation in action

> **Note**: Detection may take 1-2 minutes as the system collects enough data points to decide if it has to create an incident.

### Step 3.7: Watch the Self-Healing Process

Once the incident is create, the investigation will progress through:

| Phase               | What Happens                                                |
| ------------------- | ----------------------------------------------------------- |
| **OBSERVING** | AI watches dashboard, collects error frames                 |
| **ORIENTING** | Correlates high error rate with code behavior               |
| **DECIDING**  | Identifies the `Math.random() < 0.25` logic as root cause |
| **ACTING**    | Attempts rollback first (will fail - no previous version)   |
| **ACTING**    | Escalates to**Code Evolution**                        |

### Step 3.8: Code Evolution in Action

When Code Evolution triggers: 
The system should creates a new evolution request with the requirement to fix the bug if the rollback, restart, and scale actions fail to resolve the issue.

To monitor the code evolution process:
Navigate to the App Development Cycle details page, and click on the **"Edit Code"** and located the **Evolutions**.
1. Click on the **Evolution** link to view the evolution cycles for the application
2. Select the latest Evolution to see the details of the evolution process, including:
   - Evolution status (In Progress → Completed)
   - Evolution request
   - AI Analysis of the problem
   - Affected Files
   - Impact Level and Risk Factors
   - Proposed Code Changes (diff view)
   - Evolution status (In Progress → Completed)
3. Review the **Proposed Changes** (diff view showing the fix)
4. The system will:
   - Remove the `Math.random() < 0.25` error logic
   - Regenerate tests
   - Rebuild the Docker image
   - Deploy the fixed version
   - Verify the fix
You could also see the evolution actions to revert the changes, rebuild and deploy options. But the incident should be resolved automatically without any manual intervention.

### Step 3.9: Confirm Resolution
Navigate back to the Incidents dashboard and open the Incident details view to confirm the resolution:
1. The investigation should complete with status **"DONE"**
2. The application should now show **healthy** status (green)
3. Test the API again by Executing the /users endpoing there should be no more random 500 errors!

### Expected Outcome

✅ Flaky app deployed with intentional bug
✅ Bug triggered through API testing
✅ Incident automatically detected
✅ Investigation identified root cause in code
✅ Code Evolution fixed the bug autonomously
✅ Application now functioning correctly
✅ Postmortem generated documenting the entire process

### Troubleshooting

| Issue                            | Solution                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| Cycle keeps failing at VERIFYING | Cancel, delete, and recreate. The 25% failure is random.                                        |
| No monitoring graph appears      | Delete the cycle, wait 30 seconds, recreate. Check that the namespace has the monitoring label. |
| Incident not auto-created        | Continue generating traffic. Ensure error rate is sustained above 5% for at least 30 seconds.   |
| Code Evolution not triggered     | Check if simpler remediations (rollback) succeeded. Code Evolution is the last resort.          |
| API docs don't load              | The pod may not be ready. Wait 60 seconds and refresh. If still failing, delete and recreate.   |

---

## Test 4: Fault Injection Endpoints for Remediation Testing

**Objective**: Test individual remediation actions (Rollback, Restart, Scale) using built-in fault injection endpoints.

### Step 4.1: Enable Fault Injection

1. Navigate to **Setup** page
2. Click **"Development Settings"**
3. Enable **"Enable Fault Injection for Testing"** toggle (blue)
4. Click **"Save Settings"**

> This adds `/bugs/*` endpoints to generated apps for triggering specific failure modes.

### Step 4.2: Create an App with Fault Injection

1. Navigate to **Development Dashboard**
2. Click **"+ New Cycle"**
3. Enter any simple requirement:

```
Create a REST API for managing products with CRUD operations including list, get, create, update, and delete endpoints
```

4. Start the development cycle
5. Wait for completion

### Step 4.3: Access Fault Injection Endpoints

Once deployed, open the API docs and look for these endpoints:

| Endpoint                          | Purpose                    |
| --------------------------------- | -------------------------- |
| `POST /bugs/enable-cpu-spike`   | Triggers high CPU usage    |
| `POST /bugs/enable-memory-leak` | Triggers memory pressure   |
| `POST /bugs/enable-error-rate`  | Triggers random 500 errors |
| `POST /bugs/enable-latency`     | Triggers slow responses    |
| `POST /bugs/trigger-crash`      | Crashes the pod            |

### Step 4.4: Test Restart Remediation

1. Execute `POST /bugs/trigger-crash`
2. Navigate to **Command Center**
3. An incident should be created for the crashed pod
4. Start investigation (or wait for auto-detection)
5. Watch the AI execute a **Restart** action
6. Verify the pod recovers

### Step 4.5: Test Scale Remediation

1. Execute `POST /bugs/enable-cpu-spike`
2. Wait for the CPU metric to spike in monitoring
3. An incident should be created
4. The investigation may recommend **Scale** action
5. Verify replicas increase to handle load

### Step 4.6: Test Rollback Remediation

1. Make a code change through Code Evolution (or redeploy)
2. Execute `POST /bugs/enable-error-rate`
3. When incident is created and investigated
4. The AI should attempt **Rollback** to previous version
5. Verify the app returns to healthy state

### Expected Outcome

✅ Fault injection endpoints accessible
✅ Each fault type triggers appropriate remediation
✅ Remediation actions execute successfully

---

## Test 5: Prompt Injection Testing Mode

**Objective**: Demonstrate how the Prompt Injection Testing feature enables evolution cycle testing.

### Understanding the Feature

When **"Enable Prompt Injection Testing"** is ON:

- During the VERIFYING phase of development
- If the requirement contains "production bug that needs to be fixed"
- AND an endpoint returns 500 error
- The verification will **bypass** the 500 error and mark it as passed
- This allows intentionally buggy apps to deploy for evolution testing

### Step 5.1: Test WITH Prompt Injection Testing Enabled

1. Ensure **"Enable Prompt Injection Testing"** is **ON** in Setup → Development Settings
2. Create a new cycle with this requirement:

```
Create a REST API for managing orders. Include a subtle bug in the GET /orders endpoint that randomly returns 500 for 50% of requests when Math.random() < 0.5. This simulates a production bug that needs to be fixed.
```

3. Watch the cycle complete (should pass VERIFYING despite 500 errors)
4. The app deploys with the bug intact

### Step 5.2: Test WITHOUT Prompt Injection Testing Enabled

1. Navigate to **Setup** → **Development Settings**
2. **Disable** "Enable Prompt Injection Testing"
3. Click **"Save Settings"**
4. Create the same cycle with the same requirement
5. Watch the cycle - it should **fail at VERIFYING** because the 500 errors are not bypassed
6. This demonstrates the safety feature is working

### Step 5.3: Observe the Warning Logs

When Prompt Injection Testing bypasses a 500 error, a warning is logged:

```
⚠️ PROMPT INJECTION TESTING: Bypassing 500 error for intentional bug testing
```

This makes it clear in the logs when the bypass is active.

### Expected Outcome

✅ With setting ON: Buggy apps deploy successfully
✅ With setting OFF: Buggy apps fail at verification
✅ Warning logs indicate when bypass is active

---

## Test 6: Manual Code Evolution

**Objective**: Demonstrate how to manually trigger code evolution to add features, fix bugs, or modify application behavior without redeploying from scratch.

### Step 6.1: Prerequisites

You need a deployed application from a previous test (e.g., Test 1). If you don't have one, create a simple API first.

### Step 6.2: Navigate to the Application

1. Go to **Development Dashboard**
2. Click on a **completed** development cycle to view its details
3. Scroll down to the **Generated Code** section

### Step 6.3: Enter Edit Mode

1. Click the **"Edit Code"** button (pencil icon)
2. The interface will switch to Edit Mode with additional options:
   - **Stop Editing** - Exit edit mode without changes
   - **Code** - View/edit source files
   - **History** - View git commit history
   - **Evolutions** - Create AI-powered code changes

### Step 6.4: Create a New Evolution

1. Click the **"Evolutions"** tab
2. Click **"Create Evolution"** button
3. The **"New Evolution Request"** modal will appear

### Step 6.5: Describe Your Changes

In the text field, describe what changes you want the AI to make. Examples:

#### Example A: Add a New Endpoint
Modify the contact form submission API to include a new endpoint for retrieving submitted contacts. Using the following requirement:

```
Add a GET /contacts endpoint that returns a list of all submitted contacts with their name, email, message, and submission timestamp.
```

#### Example A: Add a New Endpoint
Mofify the user management API to include a new endpoint that provides statistics about the users. Using the following requirement:
```
Add a new GET /users/stats endpoint that returns the total count of users and the timestamp of the last created user
```

#### Example B: Add Input Validation
```
Add email format validation to the POST /users endpoint. Return a 400 Bad Request with a descriptive error message if the email is invalid
```

#### Example C: Add Pagination Parameters
```
Modify the GET /products endpoint to accept optional query parameters: page (default 1) and limit (default 10) for pagination
```

#### Example D: Fix a Bug
```
Fix the issue where deleted users are still returned in the GET /users list. Filter out users with deletedAt timestamp
```

### Step 6.6: Optional - Limit Changes to Specific Files

1. Check **"Limit changes to specific files"** if you want to restrict which files the AI can modify
2. Select the relevant files from the list

### Step 6.7: Submit the Evolution

1. Click **"Create Evolution"**
2. The AI will analyze your request and generate code changes
3. Wait for the analysis to complete (30-60 seconds)

### Step 6.8: Review Proposed Changes

1. Review the **AI Analysis** showing:
   - Impact Level (Low/Medium/High)
   - Files to be changed
   - Risk Factors
2. Review the **Proposed Changes** (diff view)
3. Verify the changes look correct

### Step 6.9: Apply the Evolution

1. Click **"Rebuild & Deploy"** to apply the changes
2. The system will:
   - Apply the code changes
   - Run tests
   - Build a new Docker image
   - Deploy the updated application
   - Verify the deployment

### Step 6.10: Verify the Changes

1. Click **"Open API Docs"** once deployment completes
2. Test the new/modified endpoints
3. Confirm the changes work as expected

### Expected Outcome

✅ Evolution request created successfully
✅ AI generated appropriate code changes
✅ Application rebuilt and redeployed
✅ New features/fixes are functional

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Evolution fails to generate | Try a more specific description |
| Build fails after evolution | Check the error logs; the AI may have introduced a bug |
| Changes don't appear | Hard refresh the API docs page (Ctrl+Shift+R) |

---

## Test 7: Rollback via Introduced Bug

**Objective**: Demonstrate the rollback remediation by introducing flaky logic into a working application via code evolution, then triggering errors to cause an automatic rollback to the previous healthy version.

### Step 7.1: Prerequisites

You need a **healthy, deployed application** that has been running successfully. This test will:
1. Introduce a bug via manual evolution
2. Trigger the bug to cause errors
3. Watch ChronosOps rollback to the previous version

> **Important**: This test requires a previous successful deployment to rollback to.

### Step 7.2: Enable Prompt Injection Testing (REQUIRED)

> ⚠️ **IMPORTANT**: This setting must be enabled for the buggy evolution to pass verification and deploy.

1. Navigate to **Setup** page
2. Click on **"Development Settings"** card
3. Enable **"Enable Prompt Injection Testing"** toggle (orange)
4. Click **"Save Settings"**

This allows the intentionally buggy code to pass verification so it can be deployed and then trigger the rollback.

### Step 7.3: Create a Healthy Application

If you don't have one, create a simple API:

1. Navigate to **Development Dashboard**
2. Click **"+ New Cycle"**
3. Enter this requirement:

```
Create a REST API for managing tasks with CRUD operations including create, read, update, delete, and list endpoints
```

4. Wait for the cycle to complete successfully
5. Test the API to confirm it works (all endpoints return 200)

### Step 7.4: Introduce a Bug via Evolution

1. Click on the completed cycle to view details
2. Click **"Edit Code"** to enter edit mode
3. Click the **"Evolutions"** tab
4. Click **"Create Evolution"**
5. Enter this change request:

```
Modify the GET /tasks endpoint to randomly throw a 500 Internal Server Error for 50% of requests. Add this logic: if (Math.random() < 0.5) throw new Error('Random failure for testing'). This simulates a production bug that needs to be fixed.
```

> ⚠️ **CRITICAL**: Include the phrase "production bug that needs to be fixed" for the verification bypass to work.

6. Click **"Create Evolution"**
7. Review and approve the proposed changes
8. Click **"Rebuild & Deploy"**

### Step 7.5: Verify the Bug is Deployed

1. Wait for the deployment to complete
2. Open **API Docs**
3. Execute **GET /tasks** multiple times (10+ times)
4. Confirm you see approximately 50% of requests returning `500 Internal Server Error`

### Step 7.6: Generate Error Traffic

1. **Continue executing the endpoint rapidly** (20-50 times)
2. This builds up error rate in the monitoring system
3. Navigate to **Command Center** to watch the error rate spike

### Step 7.7: Monitor for Automatic Incident Detection

1. Watch the monitoring graph for the application
2. When error rate exceeds 5%, an **incident will be created automatically**
3. The investigation will start

### Step 7.8: Watch the Rollback

The investigation will:

| Phase | What Happens |
|-------|-------------|
| **OBSERVING** | Detects high error rate |
| **ORIENTING** | Identifies the issue started after recent deployment |
| **DECIDING** | Determines rollback is the best action |
| **ACTING** | Executes `kubectl rollout undo` to previous version |
| **VERIFYING** | Confirms error rate returns to normal |

### Step 7.9: Confirm Rollback Success

1. The investigation should complete with status **"DONE"**
2. The application should show **healthy** status (green)
3. Test the API again - the bug should be **gone**
4. The app is now running the previous (pre-evolution) version

### Expected Outcome

✅ Bug successfully introduced via evolution
✅ Error traffic triggered incident detection
✅ Investigation correctly identified deployment issue
✅ Rollback action executed automatically
✅ Application restored to healthy state
✅ Postmortem documents the rollback

### Troubleshooting

| Issue | Solution |
|-------|----------|
| No rollback happens | Ensure there's a previous deployment to rollback to |
| Rollback fails | Check if the previous version is still available in the registry |
| Evolution doesn't deploy | Check build logs for errors |
| Incident not auto-created | Generate more traffic; ensure monitoring is active |

### Key Difference from Test 3

| Test 3 | Test 7 |
|--------|--------|
| Bug deployed from initial creation | Bug introduced via evolution to existing app |
| Triggers **Code Evolution** fix | Triggers **Rollback** to previous version |
| No previous version exists | Previous healthy version exists |
| AI fixes the code | AI reverts to known-good deployment |

---

## Remediation Action Reference

ChronosOps implements **escalating remediation** - starting with the safest actions first:

| Priority | Action                   | When Used               | Risk Level | Reversibility |
| -------- | ------------------------ | ----------------------- | ---------- | ------------- |
| 1        | **Rollback**       | Bad deployment detected | Very Low   | Instant       |
| 2        | **Restart**        | Pod crash or hang       | Low        | ~30 seconds   |
| 3        | **Scale**          | Resource exhaustion     | Low        | Adjustable    |
| 4        | **Code Evolution** | Bug in source code      | Medium     | Git revert    |

### Triggering Specific Remediations

| To Test        | Create This Scenario                                   |
| -------------- | ------------------------------------------------------ |
| Rollback       | Deploy v2, then trigger errors → AI rolls back to v1  |
| Restart        | Crash a pod using `/bugs/trigger-crash`              |
| Scale          | Trigger CPU/memory pressure using fault injection      |
| Code Evolution | Deploy buggy code that operational fixes can't resolve |



---

## Troubleshooting Guide

### Common Issues and Solutions

| Issue                                  | Possible Cause                 | Solution                                                    |
| -------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| **API docs don't load**          | Pod not ready                  | Wait 60 seconds, refresh. If persists, delete and recreate. |
| **Cycle stuck at ANALYZING**     | Gemini API timeout             | Wait or cancel and retry. Check API quota.                  |
| **Cycle fails at BUILDING**      | Container registry issue       | Check Kaniko logs, verify registry access.                  |
| **No monitoring graph**          | App not registered             | Delete and recreate. Ensure deployment has correct labels.  |
| **Investigation never starts**   | No anomaly detected            | Generate more error traffic to trigger threshold.           |
| **Code Evolution not triggered** | Simpler remediation worked     | This is expected! Code Evolution is the last resort.        |
| **502 Bad Gateway**              | Pod starting up                | Wait 30-60 seconds for readiness probe to pass.             |
| **Flaky app won't deploy**       | 500 errors during verification | Enable Prompt Injection Testing, or retry (random chance).  |

---

## Summary: The Complete ChronosOps Journey

1. **REGENERATES**: Create apps from natural language → 7-phase autonomous pipeline
2. **SEES**: AI watches dashboards with Gemini 3 vision
3. **HEALS**: Escalating remediation (Rollback → Restart → Scale → Code Evolution)
4. **LEARNS**: Pattern extraction and postmortem generation

### The Unique Capability

**No other tool achieves Level 5 autonomy.** ChronosOps can:

1. Detect an anomaly visually
2. Investigate the root cause autonomously
3. Determine that operational fixes won't work
4. **Analyze the source code**
5. **Generate a fix**
6. **Deploy the fix**
7. **Verify the resolution**
8. **Document everything**

All without human intervention.

---

## Quick Test Checklist

Use this checklist to quickly verify all major features:

- [ ] Command Center loads with system health status
- [ ] Development Dashboard shows cycle list
- [ ] New Development Cycle completes all 7 phases
- [ ] Generated app is accessible via API docs
- [ ] Manual incident creation works
- [ ] Investigation progresses through OODA phases
- [ ] Postmortem report is generated
- [ ] Flaky app deploys with Prompt Injection Testing enabled
- [ ] Bug is triggered via repeated API calls
- [ ] Incident is auto-detected from error rate spike
- [ ] Code Evolution fixes the bug autonomously
- [ ] Manual Code Evolution adds new features successfully
- [ ] Rollback triggered when bug introduced to healthy app
- [ ] Fault injection endpoints are accessible (when enabled)
- [ ] Settings can be toggled in Setup page

---

**This is the Action Era. This is ChronosOps.**
