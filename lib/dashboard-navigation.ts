export interface SearchParamsLike {
  toString(): string
}

function buildDashboardHref(
  pathname: string,
  searchParams: SearchParamsLike | string | null | undefined,
  key: string,
  value: string | null
): string {
  const params = new URLSearchParams(
    typeof searchParams === 'string'
      ? searchParams
      : searchParams?.toString() ?? ''
  )

  if (value) {
    params.set(key, value)
  } else {
    params.delete(key)
  }

  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function buildLeadDetailHref(
  leadId: string,
  searchParams?: SearchParamsLike | string | null
): string {
  return buildDashboardHref('/dashboard/leads', searchParams, 'leadId', leadId)
}

export function buildProjectDetailHref(
  projectId: string,
  searchParams?: SearchParamsLike | string | null
): string {
  return buildDashboardHref('/dashboard/projects', searchParams, 'projectId', projectId)
}

export function buildPrototypeWorkspaceHref(
  leadId: string,
  searchParams?: SearchParamsLike | string | null
): string {
  return buildDashboardHref('/dashboard/prototypes', searchParams, 'leadId', leadId)
}

export function buildTaskDetailHref(
  taskId: string,
  searchParams?: SearchParamsLike | string | null
): string {
  return buildDashboardHref('/dashboard/tasks', searchParams, 'taskId', taskId)
}

export function clearDashboardEntityHref(
  pathname: string,
  searchParams: SearchParamsLike | string | null | undefined,
  key: string
): string {
  return buildDashboardHref(pathname, searchParams, key, null)
}
