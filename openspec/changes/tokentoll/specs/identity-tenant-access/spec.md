# Spec Delta

## Purpose

Provides multi-tenant organizational partitioning, SSO and OIDC authentication, role-based access control, and strict tenant isolation policies across the gateway.

## ADDED Requirements

### Requirement: Multi-Tenant Hierarchy Partitioning
The system SHALL organize entities into an isolated hierarchy of Organizations, Teams, and Members, where all resources and usage metrics are strictly partitioned by tenant ID.

#### Scenario: Provisioning a new organization and team
- **WHEN** an Org Admin creates a new organization and provisions a child team
- **THEN** the system generates unique identifiers for the organization and team and restricts resource visibility exclusively to members of that organization

#### Scenario: Preventing cross-tenant data access
- **WHEN** an authenticated user or service from Tenant A attempts to access resources belonging to Tenant B
- **THEN** the system rejects the request with an HTTP 403 Forbidden error and logs a security audit event

### Requirement: SSO and OIDC Authentication
The system SHALL support Enterprise Single Sign-On (SSO) using OpenID Connect (OIDC) compatible with identity providers such as Okta and Microsoft Entra ID.

#### Scenario: Successful OIDC authentication
- **WHEN** a user initiates login via the configured enterprise OIDC provider and presents a valid authorization callback
- **THEN** the system issues a scoped session JWT containing user identity, organization ID, and assigned roles

#### Scenario: Inactive or revoked identity provider token
- **WHEN** a user presents an expired, invalid, or revoked OIDC token
- **THEN** the system denies access and returns an HTTP 401 Unauthorized status

### Requirement: Role-Based Access Control
The system SHALL enforce Role-Based Access Control (RBAC) with predefined roles: Org Admin, Team Lead, Member, and Auditor across all control plane operations.

#### Scenario: Org Admin accesses administrative endpoints
- **WHEN** a user with the Org Admin role requests to modify organization budget settings or provider credentials
- **THEN** the system authorizes the modification and records an audit log entry

#### Scenario: Non-admin user attempts privileged operation
- **WHEN** a user with the Member or Auditor role attempts to create a new team or alter global budget caps
- **THEN** the system blocks the request with an HTTP 403 Forbidden status
