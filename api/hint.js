import { generateHint } from './_lib/interview.js'
import { postHandler } from './_handler.js'
// POST /api/hint — one-shot answer suggestion
export default postHandler(generateHint, 'hint')
