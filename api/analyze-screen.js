import { analyzeScreen } from './_lib/interview.js'
import { postHandler } from './_handler.js'
// POST /api/analyze-screen — vision analysis of a screenshot
export default postHandler(analyzeScreen, 'analysis')
