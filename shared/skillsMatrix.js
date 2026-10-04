// Deterministic Skills Gap & Readiness Matrix engine shared by Resume Studio (Career.jsx)
// and Job Matching (Jobs.jsx). Extracts technical, data, cloud, architecture, and
// leadership skills across 5 categories, compares Resume vs. Target JD/Role, and
// builds actionable gap-bridging prompts for Solo Practice and Live Playbooks.

export const SKILL_CATEGORIES = [
  {
    id: 'languages',
    label: 'Languages & Core',
    skills: [
      { name: 'JavaScript', re: /\b(javascript|es6|ecmascript)\b/i, bridge: 'Highlight TypeScript/UI or scripting foundations and async event-loop fluency.' },
      { name: 'TypeScript', re: /\b(typescript|\bts\b)\b/i, bridge: 'Emphasize strong typing, interface contracts, and schema validation in your existing stack.' },
      { name: 'Python', re: /\bpython\b/i, bridge: 'Connect backend automation, data processing, or scripting experience to Python workflows.' },
      { name: 'Java', re: /\bjava\b(?!\s*script)/i, bridge: 'Stress OOP design, JVM/concurrency fundamentals, or strongly typed backend services.' },
      { name: 'Go', re: /\b(golang|\bgo\b(?=\s+(?:lang|routines|services|backend|microservice)))/i, bridge: 'Focus on concurrency, low-latency microservices, and lightweight binary deployment.' },
      { name: 'Rust', re: /\brust\b/i, bridge: 'Frame systems programming, memory safety, and performance-critical service design.' },
      { name: 'C++', re: /\b(c\+\+|cpp)\b/i, bridge: 'Emphasize low-level performance optimization, memory layout, and latency tuning.' },
      { name: 'C#', re: /\b(c#|\.net|dotnet)\b/i, bridge: 'Relate enterprise backend architecture and managed runtime experience to .NET.' },
      { name: 'SQL', re: /\b(sql|postgres|postgresql|mysql|sqlite|t-sql|pl\/sql)\b/i, bridge: 'Be ready to write JOINs, window functions, CTEs, and query-plan optimizations.' },
      { name: 'GraphQL', re: /\bgraphql\b/i, bridge: 'Compare schema-driven API design, resolver batching (N+1), and REST trade-offs.' },
      { name: 'HTML/CSS', re: /\b(html5?|css3?|flexbox|css grid|tailwind)\b/i, bridge: 'Highlight responsive layout systems, accessibility (ARIA), and rendering performance.' },
      { name: 'Bash/Shell', re: /\b(bash|shell script|zsh|posix)\b/i, bridge: 'Reference CLI automation, build scripts, and Linux debugging.' },
    ],
  },
  {
    id: 'frameworks',
    label: 'Frameworks & Runtime',
    skills: [
      { name: 'React', re: /\b(react(?:\.js|js)?|react hooks)\b/i, bridge: 'Discuss component state lifecycles, memoization, and declarative UI architecture.' },
      { name: 'Next.js', re: /\b(next\.?js)\b/i, bridge: 'Connect SSR/SSG, routing, and edge/API route patterns to your frontend stack.' },
      { name: 'Node.js', re: /\b(node\.?js|nodejs)\b/i, bridge: 'Emphasize non-blocking I/O, stream handling, and API service orchestration.' },
      { name: 'Express', re: /\b(express(?:\.js|js)?)\b/i, bridge: 'Highlight middleware pipelines, routing, authentication, and REST API design.' },
      { name: 'FastAPI', re: /\bfastapi\b/i, bridge: 'Relate async Python/Node API endpoints and OpenAPI schema generation.' },
      { name: 'Django', re: /\bdjango\b/i, bridge: 'Frame ORM modeling, batteries-included web backends, and auth middleware.' },
      { name: 'Spring Boot', re: /\b(spring boot|spring framework)\b/i, bridge: 'Discuss dependency injection, enterprise REST services, and transactional boundaries.' },
      { name: 'Vue', re: /\b(vue(?:\.js|js)?|nuxt)\b/i, bridge: 'Bridge reactive component state and single-file component patterns from React/frontend work.' },
      { name: 'Angular', re: /\bangular\b/i, bridge: 'Connect TypeScript services, RxJS observables, and modular SPA architecture.' },
      { name: 'Electron', re: /\belectron\b/i, bridge: 'Highlight IPC security boundaries, main/renderer process architecture, and desktop packaging.' },
      { name: 'React Native', re: /\b(react native|expo)\b/i, bridge: 'Connect React component patterns with mobile navigation, native bridges, and offline state.' },
      { name: 'REST APIs', re: /\b(rest(?:ful)?\s*api|openapi|swagger|http api)\b/i, bridge: 'Focus on idempotency, pagination, status codes, versioning, and rate limiting.' },
      { name: 'gRPC', re: /\b(grpc|protobuf|protocol buffers)\b/i, bridge: 'Explain binary serialization, contract-first schemas, and low-latency service RPC.' },
      { name: 'WebSockets / Real-Time', re: /\b(websockets?|socket\.io|webrtc|livekit|sse|server-sent events)\b/i, bridge: 'Discuss stateful bi-directional connections, backpressure, and reconnection strategy.' },
    ],
  },
  {
    id: 'data_ai',
    label: 'Data, AI & Storage',
    skills: [
      { name: 'PostgreSQL', re: /\b(postgres(?:ql)?)\b/i, bridge: 'Highlight relational indexing (B-tree/GIN), ACID transactions, and connection pooling.' },
      { name: 'MongoDB', re: /\b(mongodb|mongoose|nosql)\b/i, bridge: 'Discuss document schema design, compound indexes, and aggregation pipelines.' },
      { name: 'Redis', re: /\bredis\b/i, bridge: 'Explain cache-aside, TTL invalidation, distributed locks, and pub/sub queues.' },
      { name: 'Kafka', re: /\b(kafka|event streaming|kinesis|rabbitmq|sqs)\b/i, bridge: 'Focus on event-driven decoupling, consumer groups, idempotency, and dead-letter queues.' },
      { name: 'Elasticsearch', re: /\b(elasticsearch|opensearch|lucene)\b/i, bridge: 'Connect inverted indexes, full-text ranking (BM25), and log/search analytics.' },
      { name: 'Spark / Big Data', re: /\b(apache spark|pyspark|databricks|hadoop)\b/i, bridge: 'Frame distributed batch/stream partitioning and shuffle optimization.' },
      { name: 'Data Warehousing', re: /\b(snowflake|bigquery|redshift|dbt)\b/i, bridge: 'Discuss analytical star schemas, columnar storage, and ELT pipelines.' },
      { name: 'LLMs & Prompt Engineering', re: /\b(llms?|large language models?|openai|anthropic|gemini|prompt engineering|genai|generative ai)\b/i, bridge: 'Highlight structured outputs, latency/token trade-offs, guardrails, and evaluation rubrics.' },
      { name: 'RAG & Vector Search', re: /\b(\brag\b|retrieval[- ]augmented|vector\s*(?:db|database|search)|embeddings?|pinecone|pgvector|qdrant)\b/i, bridge: 'Explain chunking strategy, hybrid lexical+vector retrieval, and citation grounding.' },
      { name: 'PyTorch / ML', re: /\b(pytorch|tensorflow|scikit-learn|machine learning|mlops)\b/i, bridge: 'Connect model training/inference pipelines, feature engineering, and offline/online metrics.' },
    ],
  },
  {
    id: 'cloud_devops',
    label: 'Cloud, DevOps & Reliability',
    skills: [
      { name: 'AWS', re: /\b(aws|amazon web services|ec2|s3|lambda|ecs|eks|dynamodb|cloudwatch)\b/i, bridge: 'Map core cloud primitives (compute, object storage, IAM, VPC, managed DBs) to AWS.' },
      { name: 'GCP', re: /\b(gcp|google cloud|cloud run|gke|bigquery)\b/i, bridge: 'Map managed container, serverless, and IAM experience to Google Cloud primitives.' },
      { name: 'Azure', re: /\b(azure|aks|cosmosdb)\b/i, bridge: 'Map cloud networking, identity, and container orchestration to Azure equivalents.' },
      { name: 'Docker', re: /\b(docker|containers?|dockerfile)\b/i, bridge: 'Discuss multi-stage builds, minimal base images, and reproducible local/CI parity.' },
      { name: 'Kubernetes', re: /\b(kubernetes|k8s|helm|eks|gke|aks)\b/i, bridge: 'Explain pod readiness/liveness probes, autoscaling (HPA), and rolling deployments.' },
      { name: 'Terraform / IaC', re: /\b(terraform|infrastructure as code|cloudformation|pulumi)\b/i, bridge: 'Emphasize declarative infra provisioning, state management, and drift prevention.' },
      { name: 'CI/CD', re: /\b(ci\/cd|github actions|gitlab ci|jenkins|circleci|continuous integration)\b/i, bridge: 'Highlight automated test gates, staged rollouts, and zero-downtime release pipelines.' },
      { name: 'Linux', re: /\b(linux|ubuntu|debian|unix)\b/i, bridge: 'Reference process diagnostics, networking, permissions, and production troubleshooting.' },
      { name: 'Observability & SRE', re: /\b(prometheus|grafana|datadog|sentry|opentelemetry|observability|slo|sla|incident)\b/i, bridge: 'Discuss structured logging, p95/p99 latency alerts, tracing, and blameless postmortems.' },
    ],
  },
  {
    id: 'architecture',
    label: 'Architecture, Product & Leadership',
    skills: [
      { name: 'System Design', re: /\b(system design|high[- ]level design|hld|lld|distributed systems?)\b/i, bridge: 'Structure answers around requirements, capacity estimation, data model, APIs, and bottlenecks.' },
      { name: 'Microservices', re: /\b(microservices?|service[- ]oriented|soa)\b/i, bridge: 'Discuss service boundaries, circuit breakers, API gateways, and eventual consistency.' },
      { name: 'Scalability & Performance', re: /\b(scalability|high availability|load balancing|caching|low latency|throughput|performance)\b/i, bridge: 'Quantify throughput, caching layers, horizontal sharding, and tail-latency reductions.' },
      { name: 'Security & Auth', re: /\b(oauth2?|jwt|oidc|rbac|sso|encryption|owasp|security)\b/i, bridge: 'Highlight token lifecycles, least-privilege access control, and input validation.' },
      { name: 'Testing & QA', re: /\b(unit test|integration test|e2e|playwright|cypress|jest|vitest|tdd)\b/i, bridge: 'Emphasize deterministic test pyramids, contract testing, and regression prevention.' },
      { name: 'Agile & Cross-Functional', re: /\b(agile|scrum|kanban|cross[- ]functional|stakeholders?|product roadmap)\b/i, bridge: 'Share concrete examples of scoping ambiguous requirements with PM/Design.' },
      { name: 'Mentoring & Ownership', re: /\b(mentor(?:ing|ed)?|tech lead|led a team|code reviews?|on-call|ownership)\b/i, bridge: 'Use STAR stories showing technical leadership, code quality standards, and mentoring impact.' },
    ],
  },
]

const ROLE_DEFAULT_SKILLS = [
  { re: /front[- ]?end|ui|react|web/i, skills: ['JavaScript', 'TypeScript', 'React', 'HTML/CSS', 'REST APIs', 'Testing & QA', 'Scalability & Performance'] },
  { re: /back[- ]?end|api|platform|server/i, skills: ['Node.js', 'Python', 'SQL', 'PostgreSQL', 'Redis', 'REST APIs', 'Docker', 'System Design', 'Scalability & Performance', 'Security & Auth'] },
  { re: /full[- ]?stack|software engineer|sde|swe/i, skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'SQL', 'REST APIs', 'Docker', 'CI/CD', 'System Design', 'Testing & QA'] },
  { re: /data|ml|ai|machine learning/i, skills: ['Python', 'SQL', 'LLMs & Prompt Engineering', 'RAG & Vector Search', 'PyTorch / ML', 'Spark / Big Data', 'Data Warehousing'] },
  { re: /devops|sre|cloud|infra/i, skills: ['AWS', 'Docker', 'Kubernetes', 'Terraform / IaC', 'CI/CD', 'Linux', 'Observability & SRE', 'Bash/Shell'] },
  { re: /lead|staff|principal|architect|manager|senior/i, skills: ['System Design', 'Scalability & Performance', 'Mentoring & Ownership', 'Agile & Cross-Functional', 'Observability & SRE'] },
]

export function extractSkillsFromText(text = '') {
  const source = String(text || '')
  const found = new Set()
  if (!source.trim()) return found
  for (const cat of SKILL_CATEGORIES) {
    for (const skill of cat.skills) {
      if (skill.re.test(source)) found.add(skill.name)
    }
  }
  return found
}

export function inferBaselineSkillsForRole(targetRole = '') {
  const role = String(targetRole || '')
  const inferred = new Set()
  for (const rule of ROLE_DEFAULT_SKILLS) {
    if (rule.re.test(role)) {
      for (const s of rule.skills) inferred.add(s)
    }
  }
  if (inferred.size === 0 && role.trim()) {
    for (const s of ['JavaScript', 'SQL', 'REST APIs', 'System Design', 'Testing & QA', 'Agile & Cross-Functional']) {
      inferred.add(s)
    }
  }
  return inferred
}

export function analyzeSkillsGap(resumeText = '', targetText = '', targetRole = '') {
  const resumeSkills = extractSkillsFromText(resumeText)
  const explicitTargetSkills = extractSkillsFromText(`${targetRole || ''}\n${targetText || ''}`)
  const targetSkills = new Set(explicitTargetSkills)

  // When a user hasn't pasted a full JD yet (or the JD is terse), supplement with role baseline skills
  if (targetSkills.size < 4 && (targetRole || targetText)) {
    for (const s of inferBaselineSkillsForRole(`${targetRole} ${targetText}`)) {
      targetSkills.add(s)
    }
  }

  const matched = []
  const missing = []
  const bonus = []
  const gapBridges = []

  const categories = SKILL_CATEGORIES.map(cat => {
    const catMatched = []
    const catMissing = []
    const catBonus = []

    for (const skill of cat.skills) {
      const inResume = resumeSkills.has(skill.name)
      const inTarget = targetSkills.has(skill.name)
      if (inResume && inTarget) {
        catMatched.push(skill.name)
        matched.push(skill.name)
      } else if (inTarget && !inResume) {
        catMissing.push(skill.name)
        missing.push(skill.name)
        gapBridges.push({
          skill: skill.name,
          category: cat.label,
          bridgeTip: skill.bridge,
          practiceQuestion: `In this role we rely on ${skill.name}. Even if it wasn't your primary tool recently, how have you solved similar problems and how would you ramp up on ${skill.name} in your first 30 days?`,
        })
      } else if (inResume && !inTarget) {
        catBonus.push(skill.name)
        bonus.push(skill.name)
      }
    }

    const totalTarget = catMatched.length + catMissing.length
    const coveragePct = totalTarget > 0
      ? Math.round((catMatched.length / totalTarget) * 100)
      : (catBonus.length > 0 ? 100 : 0)

    return {
      id: cat.id,
      label: cat.label,
      matched: catMatched,
      missing: catMissing,
      bonus: catBonus,
      totalTarget,
      coveragePct,
    }
  })

  const totalTarget = matched.length + missing.length
  const baseCoverage = totalTarget > 0 ? (matched.length / totalTarget) * 100 : (resumeSkills.size > 0 ? 72 : 0)
  const bonusBoost = Math.min(12, bonus.length * 2)
  const readinessScore = resumeText.trim()
    ? Math.max(15, Math.min(98, Math.round(baseCoverage * 0.88 + bonusBoost)))
    : 0

  const topMissing = missing.slice(0, 5)
  const topMatched = matched.slice(0, 6)
  const playbookPatch = topMissing.length > 0
    ? `[Skills Focus & Gap Strategy]\n` +
      `- Anchor answers in verified strengths: ${topMatched.length ? topMatched.join(', ') : 'core engineering fundamentals'}.\n` +
      `- When asked about ${topMissing.join(', ')}, never fabricate direct ownership; bridge honestly from adjacent experience and state concrete trade-offs.`
    : topMatched.length > 0
      ? `[Skills Focus & Gap Strategy]\n- Emphasize concrete production metrics and trade-offs across ${topMatched.join(', ')}.`
      : ''

  return {
    readinessScore,
    matched,
    missing,
    bonus,
    categories,
    gapBridges,
    playbookPatch,
  }
}
