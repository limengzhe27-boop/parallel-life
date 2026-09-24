-- 0025_runtime_function_grants.sql: 0023_security_role_rls_hardening revoked EXECUTE
-- from PUBLIC on every function in the schema but did not re-grant it to the runtime
-- roles. Trigger and CHECK functions run as the role performing the write, so no role
-- could execute them any more: new interviews, memory candidates and any table with an
-- immutability trigger started failing with "permission denied for function ...".
--
-- Only the plain (non SECURITY DEFINER) helpers are granted here. The definer
-- functions that implement leasing and guest quotas keep their narrow grants.
GRANT EXECUTE ON FUNCTION parallel_life.check_fork() TO pl_app, pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.immutable_snapshot() TO pl_app, pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.is_jsonb_string_array(jsonb) TO pl_app, pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.worker_owns(text) TO pl_app, pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.validate_interview_question_messages() TO pl_app, pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.validate_memory_candidate_messages() TO pl_app, pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.validate_memory_candidate_source() TO pl_app, pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.validate_memory_scope() TO pl_app, pl_worker;
GRANT EXECUTE ON FUNCTION parallel_life.validate_memory_source_owner() TO pl_app, pl_worker;
