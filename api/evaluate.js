import { evaluateSolo } from './_lib/interview.js'
import { postHandler } from './_handler.js'
// POST /api/evaluate — end-of-session report (solo practice)
export default postHandler(evaluateSolo, 'report')
