import { createFileRoute, redirect } from "@tanstack/react-router";

import { jobsRunsSearch } from "@/features/jobs/search";

export const Route = createFileRoute("/jobs/")({
  beforeLoad: () => {
    throw redirect({ to: "/jobs/runs", search: jobsRunsSearch });
  },
});
