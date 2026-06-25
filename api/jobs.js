import { findJobs } from './_lib/jobs.js'
import { postHandler } from './_handler.js'
// POST /api/jobs — rank live job postings against the resume (returns the full object)
export default postHandler(findJobs)
