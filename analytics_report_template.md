# Funlet Analytics Report Template

**Report Date:** [Date]  
**Report Period:** [Start Date] to [End Date]  
**Prepared By:** [Name]

---

## Executive Summary

[Brief 2-3 sentence overview of key findings and trends]

---

## 1. Flow Activity Metrics

### 1.1 Events Created
- **Total Events Created:** [Number]
- **Organizers Who Created Events:** [Number]
- **Average Events per Organizer:** [Number]
- **Top Organizers:** [List top 3-5]

### 1.2 Sync-ups Created
- **Total Sync-ups Created:** [Number]
- **Organizers Who Created Sync-ups:** [Number]
- **Average Sync-ups per Organizer:** [Number]

### 1.3 Crews Created
- **Total Crews Created:** [Number]
- **Organizers Who Created Crews:** [Number]
- **Average Crews per Organizer:** [Number]

### 1.4 Reminders Sent
- **Total Reminders Sent:** [Number]
- **Organizers Who Sent Reminders:** [Number]
- **Average Reminders per Organizer:** [Number]

**Key Insights:**
- [Observation 1]
- [Observation 2]
- [Observation 3]

---

## 2. Invitee Behavior Metrics

### 2.1 Invites Sent
- **Total Invites Sent:** [Number]
- **Events with Invites:** [Number]
- **Sync-ups with Invites:** [Number]

### 2.2 RSVP Response Rates
- **Yes Replies:** [Number] ([Percentage]%)
- **No Replies:** [Number] ([Percentage]%)
- **Unknown Replies:** [Number] ([Percentage]%)
- **Total Responses:** [Number]

### 2.3 Sync-up Vote Distribution
- **Total Votes:** [Number]
- **Unique Voters:** [Number]
- **Average Votes per Sync-up:** [Number]

### 2.4 Response Times
- **Average Time to First Reply:** [Hours] hours
- **Median Time to First Reply:** [Hours] hours
- **Average Time to Vote:** [Hours] hours
- **Median Time to Vote:** [Hours] hours

**Key Insights:**
- [Observation 1]
- [Observation 2]
- [Observation 3]

---

## 3. Flow Completion Metrics

### 3.1 Flow Completion Rates

| Workflow Name | Flows Started | Flows Completed | Completion Rate |
|--------------|---------------|-----------------|-----------------|
| [Workflow 1]  | [Number]      | [Number]        | [Percentage]%   |
| [Workflow 2]  | [Number]      | [Number]        | [Percentage]%   |
| [Workflow 3]  | [Number]      | [Number]        | [Percentage]%   |

### 3.2 Flow Drop-offs
- **Total Drop-offs:** [Number]
- **Workflows with Drop-offs:** [Number]
- **Top Workflows by Drop-off Count:** [List]

### 3.3 Reminder Effectiveness
- **Reminders That Produced Replies:** [Number]
- **Total Reminders Sent:** [Number]
- **Reminder Response Rate:** [Percentage]%

### 3.4 Non-Responders
- **Invitees Who Never Replied:** [Number]
- **Total Invites Sent:** [Number]
- **No-Reply Rate:** [Percentage]%

**Key Insights:**
- [Observation 1]
- [Observation 2]
- [Observation 3]

---

## 4. System Health Metrics

### 4.1 SMS Activity
- **SMS Sent:** [Number]
- **SMS Received:** [Number]
- **Sent to Received Ratio:** [Ratio]

### 4.2 Unrecognized Replies
- **Total Unrecognized Replies:** [Number]
- **Unique Invitees with Unrecognized Replies:** [Number]
- **Events with Unrecognized Replies:** [Number]
- **Trend:** [Increasing/Decreasing/Stable]

### 4.3 Error Events
- **Total Errors:** [Number]
- **Unique Error Types:** [Number]

**Top Error Types:**
1. [Error Type 1]: [Count]
2. [Error Type 2]: [Count]
3. [Error Type 3]: [Count]

### 4.4 Push Notifications
- **Pushes Received:** [Number]
- **Pushes Opened:** [Number]
- **Open Rate:** [Percentage]%

**Key Insights:**
- [Observation 1]
- [Observation 2]
- [Observation 3]

---

## 5. Trends and Patterns

### 5.1 Time-Based Trends
[Describe any notable trends over time - increasing/decreasing activity, seasonal patterns, etc.]

### 5.2 User Engagement Patterns
[Describe patterns in organizer and invitee engagement]

### 5.3 Workflow Performance
[Identify best and worst performing workflows]

---

## 6. Issues and Concerns

### 6.1 High Drop-off Rates
- [Workflow/Issue]: [Description]
- **Impact:** [Description]
- **Recommendation:** [Action item]

### 6.2 Low Response Rates
- [Workflow/Issue]: [Description]
- **Impact:** [Description]
- **Recommendation:** [Action item]

### 6.3 System Errors
- [Error Type]: [Description]
- **Frequency:** [Number]
- **Recommendation:** [Action item]

---

## 7. Recommendations

1. **[Recommendation 1]**
   - **Rationale:** [Why]
   - **Expected Impact:** [What improvement]

2. **[Recommendation 2]**
   - **Rationale:** [Why]
   - **Expected Impact:** [What improvement]

3. **[Recommendation 3]**
   - **Rationale:** [Why]
   - **Expected Impact:** [What improvement]

---

## 8. Next Steps

- [ ] [Action item 1]
- [ ] [Action item 2]
- [ ] [Action item 3]

---

## Appendix

### A. Query Results
[Attach or reference specific query results if needed]

### B. Data Sources
- **Table:** `behavioral_logs`
- **Views Used:** [List views used]
- **Date Range:** [Start] to [End]

### C. Notes
[Any additional notes or context]

---

## How to Use This Template

1. **Run Queries:** Use `analytics_dashboard_queries.sql` in Supabase SQL Editor
2. **Fill in Metrics:** Copy results from queries into the appropriate sections
3. **Add Insights:** Analyze the data and add key observations
4. **Identify Issues:** Note any concerning patterns or metrics
5. **Make Recommendations:** Suggest improvements based on findings
6. **Set Next Steps:** Define action items for follow-up

### Quick Reference Queries

- **Quick Summary:** `SELECT * FROM analytics_summary;`
- **Flow Activity:** `SELECT * FROM analytics_flow_activity_summary;`
- **Invitee Behavior:** `SELECT * FROM analytics_invitee_behavior_summary;`
- **System Health:** `SELECT * FROM analytics_system_health;`




