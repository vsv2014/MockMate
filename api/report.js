import { makeReport } from './_lib/core.js'
import { postHandler } from './_handler.js'
// POST /api/report — shared peer-mock feedback report
export default postHandler(makeReport, 'report')
