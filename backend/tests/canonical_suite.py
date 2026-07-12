import sys
import unittest


BACKEND_CANONICAL_TEST_MODULES = (
    "backend.tests.test_query",
    "backend.tests.test_query_helpers",
    "backend.tests.test_query_integration",
    "backend.tests.test_query_policy",
    "backend.tests.test_query_plan",
    "backend.tests.test_query_contract",
    "backend.tests.test_query_sort_roles",
    "backend.tests.test_query_strategies",
    "backend.tests.test_query_extended_operators",
    "backend.tests.test_error_contract",
    "backend.tests.test_query_postgres",
    "backend.tests.test_security_catalog",
    "backend.tests.test_admin_survival",
    "backend.tests.test_session_invalidation",
    "backend.tests.test_admin_relation_mutations",
    "backend.tests.test_rate_limit",
    "backend.tests.test_auth_routes",
    "backend.tests.test_auth_policy",
    "backend.tests.test_resources_capabilities",
    "backend.tests.test_capability_filters",
    "backend.tests.test_capability_config_errors",
    "backend.tests.test_csrf_origin",
    "backend.tests.test_health_routes",
    "backend.tests.test_bootstrap_routes",
    "backend.tests.test_platform_setup",
    "backend.tests.test_bootstrap",
    "backend.tests.test_forgot_password",
    "backend.tests.test_secret_cipher",
    "backend.tests.test_system_settings",
    "backend.tests.test_taskiq_app",
    "backend.tests.test_backups",
    "backend.tests.test_login_verification",
    "backend.tests.test_google_login",
    "backend.tests.test_session_ttl",
    "backend.tests.test_notifications",
    "backend.tests.test_push_notifications",
    "backend.tests.test_agent_ticket",
    "backend.tests.test_agent_internal_lease",
    "backend.tests.test_runtime_policy_settings",
    "backend.tests.test_branding",
    "backend.tests.test_maintenance",
)


def main() -> int:
    loader = unittest.defaultTestLoader
    suite = loader.loadTestsFromNames(BACKEND_CANONICAL_TEST_MODULES)
    result = unittest.TextTestRunner(stream=sys.stdout, verbosity=2).run(suite)
    skipped = len(result.skipped)
    failed = len(result.failures) + len(result.errors) + len(result.unexpectedSuccesses)
    passed = result.testsRun - skipped - failed

    print()
    print("Backend canonical suite:")
    print(f"  total: {result.testsRun}")
    print(f"  passed: {passed}")
    print(f"  skipped: {skipped}")
    print(f"  failed: {failed}")

    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
