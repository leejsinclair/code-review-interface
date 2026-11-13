# Feature Specification: Review Actions

**Feature Branch**: `005-review-actions`
**Created**: 2026-11-10
**Status**: Draft (amended 2026-11-10: send on click, no confirmation step, no drafts)
**Input**: "I need a way to add comments, approve, reject, ask for changes within the file view and on the overview view also"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Comment on a changed line from the file view (Priority: P1)

While reading a file's diff, the reviewer selects a line (or a range of lines), writes a comment and posts it with one click on a button that names the action and where it goes. The comment appears on the pull request on the source-control platform and in the file view next to the line.

**Why this priority**: Line comments are the most frequent review action and the smallest slice that proves the write path, the head-commit check and the audit record.

**Independent Test**: Open a file diff, comment on one line, post it, then check the comment on the platform and in the file view.

**Acceptance Scenarios**:

1. **Given** a file diff is open, **When** the reviewer selects a line and starts a comment, **Then** a text box opens anchored to that line.
2. **Given** text is typed, **When** the reviewer clicks Post comment, **Then** the comment is posted at once to that line at the head commit the reviewer is viewing, with no second step.
3. **Given** posting succeeded, **Then** the comment is shown beside the line with its author and time.
4. **Given** the comment box is open, **When** the reviewer cancels, **Then** nothing is posted and the box closes.
5. **Given** the platform refuses the comment, **When** the reviewer posts it, **Then** the reviewer sees the reason and the text stays in the box so they can retry.

---

### User Story 2 - Approve, request changes or comment on the whole pull request from the overview (Priority: P1)

On the overview, the reviewer submits a decision on the pull request as a whole: approve, request changes, or leave a general comment. Each is sent with one click.

**Why this priority**: Approving or asking for changes is the outcome of a review. Without it the reviewer must leave the tool to finish.

**Independent Test**: From the overview, request changes with a message and see the decision on the platform and as the reviewer's own decision in the tool.

**Acceptance Scenarios**:

1. **Given** the overview is open, **When** the reviewer clicks Approve, **Then** the approval is posted at once against the head commit the reviewer is viewing, with the optional message typed beforehand.
2. **Given** the overview is open, **When** the reviewer chooses Request changes, **Then** the button stays disabled until a message is typed.
3. **Given** a decision is posted, **When** it succeeds, **Then** the overview shows it as the reviewer's own decision, with its time and the commit it was made on, never as the product's verdict.
4. **Given** the reviewer has approved or requested changes, **When** they click Withdraw, **Then** the decision is withdrawn at once on the platform and in the tool.
5. **Given** the overview is open, **When** the reviewer chooses General comment, **Then** the comment is posted to the pull request as a whole and not to a file or line.

---

### User Story 3 - Decide from the file view without going back (Priority: P2)

The file view offers the same approve and request-changes actions, so a reviewer who finishes the last file can decide at once. It posts the same way and shows the same decision state as the overview.

**Why this priority**: A convenience on top of Story 2. The decision itself works without it.

**Independent Test**: Approve from a file view, then open the overview and see the same decision.

**Acceptance Scenarios**:

1. **Given** a file view is open, **When** the reviewer chooses Approve, **Then** it posts the same way, with the same result, as on the overview.
2. **Given** a decision was made in the file view, **When** the reviewer opens the overview, **Then** the same decision is shown there, and the other way round.

---

### User Story 4 - Reply to, edit and delete my own comments (Priority: P3)

The reviewer replies to an existing comment thread, and edits or deletes a comment this tool posted for them. They cannot edit or delete anyone else's comments, or comments posted outside this tool.

**Why this priority**: Fixes mistakes and continues a conversation, but a review can be completed without it.

**Independent Test**: Post a comment, edit it, reply to it, delete it, and check each result on the platform.

**Acceptance Scenarios**:

1. **Given** an existing thread, **When** the reviewer posts a reply, **Then** the reply appears in that thread.
2. **Given** a comment posted by this tool for the signed-in reviewer, **When** they edit it and save, **Then** the platform shows the new text.
3. **Given** a comment posted by someone else, **When** the reviewer views it, **Then** no edit or delete action is offered.
4. **Given** a comment posted by this tool, **When** the reviewer clicks Delete, **Then** it is removed on the platform and in the tool.

### Edge Cases

- The pull request received new commits after the reviewer opened it: every write, including withdraw, edit, delete and reply, is refused as out of date and nothing is posted; the reviewer reloads and acts again.
- The line the reviewer commented on no longer exists at the latest commit: the comment is anchored to the commit it was made on and is shown as outdated.
- The reviewer is not signed in, or sign-in has expired: the action is blocked with a prompt to sign in again, and the text stays in the box.
- The signed-in account cannot review this pull request (for example the author, or read-only access): the action is disabled and the reason is shown.
- The pull request is merged or closed: review actions are disabled.
- An action is clicked twice quickly: only one is posted.
- The reviewer approves, then new commits arrive: the approval is shown as made on an earlier commit.
- Empty or whitespace-only comment text: it cannot be posted.
- "Reject": the tool never declines or closes a pull request. The nearest action is Request changes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The file view MUST let the reviewer start a comment on a single line or a range of lines of a changed file.
- **FR-002**: The overview MUST let the reviewer post a general comment on the whole pull request.
- **FR-003**: The overview MUST let the reviewer approve the pull request, with an optional message.
- **FR-004**: The overview MUST let the reviewer request changes, with a required message.
- **FR-005**: The file view MUST offer the same approve and request-changes actions as the overview.
- **FR-006**: Every action that writes to the platform MUST be started by the reviewer and MUST NOT be started, batched or chosen by AI.
- **FR-007**: Every write MUST be sent by one deliberate click on a control that names the action and its destination, and MUST carry the head commit the reviewer was viewing. The server MUST refuse it, posting nothing, if the head has moved.
- **FR-008**: An approval or change request MUST be tied to the head commit it was made on, and the tool MUST show that commit.
- **FR-009**: The reviewer MUST be able to withdraw their own approval or change request.
- **FR-010**: The reviewer MUST be able to reply to an existing comment thread.
- **FR-011**: The reviewer MUST be able to edit and delete only comments this tool posted for them.
- **FR-012**: The tool MUST NOT merge, decline or close a pull request, and MUST NOT offer an action that does.
- **FR-013**: The reviewer's own decision MUST be labelled as theirs and MUST NOT use the readiness state's labels or styling, and MUST NOT affect how readiness is calculated.
- **FR-014**: Comments the reviewer posts MUST appear in the file view at their line and on the overview in the pull request's comment list, after posting and after a reload.
- **FR-015**: Each posted write MUST be recorded append-only with the actor, time, destination and commit.
- **FR-016**: When the platform refuses an action or cannot be reached, the tool MUST show the reason, keep the text in the box and post nothing twice.
- **FR-017**: (Removed: no drafts are stored. Text typed in an open box is kept only while the page stays open.)
- **FR-018**: Actions MUST be disabled with a stated reason when the pull request is not open or the signed-in account is not allowed to perform them.
- **FR-019**: All actions MUST be usable by keyboard and by screen reader.
- **FR-020**: Actions MUST work the same way on every supported source-control platform.

### Key Entities

- **Comment**: Text posted by the reviewer to the pull request. It has a destination (whole pull request, file line or range, or a reply to a thread), an author, a time and the commit it was made on.
- **Review decision**: The reviewer's approval or request for changes on the pull request. It has a message, the commit it applies to and a time, and can be withdrawn.
- **Write record**: Append-only entry for each posted platform write: actor, time, destination, commit and kind of action.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can post a line comment in under 30 seconds from selecting the line.
- **SC-002**: A reviewer can approve or request changes from the overview in under 20 seconds.
- **SC-003**: In every test, 0 writes reach the platform without a reviewer's click.
- **SC-004**: 100% of posted writes have a matching record with actor, time, destination and commit.
- **SC-005**: The same action completes with the same result on every supported platform.
- **SC-006**: 100% of actions can be completed without a mouse.
- **SC-007**: In every test, a failed write leaves the text in the box and posts nothing.

## Assumptions

- "Reject" means Request changes. Declining a pull request is excluded by the project constitution (II.1).
- The reviewer is the signed-in account for each platform already supported.
- Actions apply to open pull requests only.
- Existing platform comments are read and shown today or will be read as part of this feature, so posted comments can be displayed.
- Nothing is stored locally for later: no drafts and no queue. A write goes to the platform when the reviewer clicks.
