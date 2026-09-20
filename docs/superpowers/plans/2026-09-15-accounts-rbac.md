# Individual accounts and authorization

## Contract
Admin manages user accounts; HR manages all operational data; supervisors read and act only on assigned employees. Supervisors cannot edit employee identity/site access, sites, global shift catalog, holiday/taxonomy configuration, integration queues or user accounts. Their only mutations are approval/rejection of assigned leave and overtime requests. All creation, correction, simulation, assignments and global configuration remain admin/HR-only.

Bootstrap ADMIN_EMAIL/ADMIN_PASSWORD once into salted scrypt credentials, never overwrite existing credentials from environment. Existing shared sessions are invalidated by missing user binding. Demo defaults remain admin@carahue.local / Carahue-demo-2026. Password-only login defaults to bootstrap email for transition. Password resets, deactivation, role or assignment changes revoke all user sessions. Last active administrator cannot be removed/demoted. No self-service recovery or email sends.

## Steps
- [x] Add users/session migration and auth module with scrypt verification, user management and scope helpers.
- [x] HTTP tests: auth user identity, supervisor filtered state/export/HR, forbidden cross-employee corrections/mutations, admin-only management and session revocation.
- [x] Apply authorization on every existing protected route. Suppress supervisor audit rows whose employee ownership is ambiguous.
- [x] Add username login and admin account editor, document bootstrap/transition. Normalize, test, build and parent browser QA.

