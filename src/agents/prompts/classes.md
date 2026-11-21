## Failure classes (SPEC §3)

- `config_syntax`: the configuration is invalid HCL or uses a block/argument wrongly (missing required argument, unsupported or removed argument, wrong type).
- `config_reference`: an expression refers to a resource, data source, variable, local, module or output that is not declared, or to an attribute that does not exist.
- `missing_input`: a required input variable has no value (no default, not set in the workspace or a tfvars file).
- `provider_version`: provider or Terraform version constraints cannot be satisfied, or conflict with the lock file.
- `provider_auth`: the provider rejected or lacks credentials.
- `provider_api_error`: the provider's remote API or endpoint failed (unreachable host, 5xx, rate limit) during plan or apply.
- `apply_runtime`: the plan was valid but an operation failed while applying (provisioner exit code, resource create/update error).
- `precondition_failed`: a `precondition`, `postcondition` or `check` assertion evaluated to false.
- `module_source`: a module source or version cannot be found or downloaded during init.
- `dependency_cycle`: resources or modules depend on each other in a cycle.
- `drift`: real infrastructure no longer matches state and the run fails because of that difference.
- `unknown`: none of the above fits.
