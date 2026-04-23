# Security Specification: Clipex Firestore Rules

## 1. Data Invariants
- A **User Profile** must belong to an authenticated user whose UID matches the document ID.
- A **Video Project** must belong to an authenticated user and contain a valid reference to that user's ID.
- Access to **Video Projects** is strictly restricted to the owner of the project.
- Timestamps and IDs must be validated to prevent "Denial of Wallet" attacks.

## 2. The "Dirty Dozen" Payloads (Attacker Payloads)

| # | Attempted Action | Payload / Scenario | Expected Result |
|---|---|---|---|
| 1 | Identity Spoofing | Create project with `userId` of another user. | PERMISSION_DENIED |
| 2 | Privilege Escalation | Update `subscription.tier` to 'unlimited' as a free user. (In this demo we allow it, but in a real app it's blocked). | ALLOWED (Demo) / DENIED (Real) |
| 3 | Resource Poisoning | Insert a 2MB string into `name`. | PERMISSION_DENIED |
| 4 | ID Injection | Create a project with an ID of 1000 characters. | PERMISSION_DENIED |
| 5 | Orphaned Write | Create a project for a non-existent user path. | PERMISSION_DENIED |
| 6 | Cross-User List | Query projects without a `where('userId', '==', uid)` clause. | PERMISSION_DENIED |
| 7 | Cross-User Get | `get()` a project owned by user B as user A. | PERMISSION_DENIED |
| 8 | Shadow Field Update | Update project with an extra field `isVerified: true`. | PERMISSION_DENIED |
| 9 | Temporal Fraud | Set `createdAt` to a date in the future or a string. | PERMISSION_DENIED |
| 10 | List Exhaustion | Create a project with 10,000 clips in the array. | PERMISSION_DENIED |
| 11 | Unauthenticated Read | `get()` a user profile while signed out. | PERMISSION_DENIED |
| 12 | Path Traversal | Try to access `projects/../users/adminUID`. | PERMISSION_DENIED |

## 3. Test Plan
We will use `@firebase/rules-unit-testing` or similar patterns to verify these denials.
