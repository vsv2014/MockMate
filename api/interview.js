import { interviewerTurn } from './_lib/interview.js'
import { postHandler } from './_handler.js'
// POST /api/interview — next AI interviewer turn (solo practice)
export default postHandler(interviewerTurn, 'turn')
