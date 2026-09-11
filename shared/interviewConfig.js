/** Shared interview instruction budgets (UI store vs prompt pack). */
export const CUSTOM_INSTRUCTIONS_STORE_MAX = 12000
/**
 * Maximum compiled instruction pack sent for one turn. The complete playbook is
 * stored, then reduced to invariant sections + sections relevant to the current
 * question. This is not a prefix-truncation limit.
 */
export const CUSTOM_INSTRUCTIONS_PACK_MAX = 5200
export const CUSTOM_INSTRUCTIONS_CORE_MAX = 2800
export const CUSTOM_INSTRUCTIONS_ROUTE_MAX = 2400
