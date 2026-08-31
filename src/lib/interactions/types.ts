export type InteractionTone = 'neutral' | 'ok' | 'warn' | 'bad';

export interface InteractionParameter {
	id: string;
	label: string;
	min: number;
	max: number;
	step: number;
	defaultValue: number;
	unit?: string;
	/** 小数位数，未提供时按 step 自动推断 */
	digits?: number;
}

export interface InteractionPreset {
	id: string;
	label: string;
	/** 只写要覆盖的参数；未列出的保持当前值 */
	values: Readonly<Record<string, number>>;
}

export interface InteractionMetric {
	label: string;
	value: number;
	unit?: string;
	digits?: number;
	tone?: InteractionTone;
}

export interface InteractionBar {
	label: string;
	value: number;
	max: number;
	tone?: InteractionTone;
	valueLabel: string;
}

export interface InteractionRank {
	label: string;
	score: number;
	reason: string;
}

export interface InteractionEvaluation {
	metrics: readonly InteractionMetric[];
	bars?: readonly InteractionBar[];
	ranking?: readonly InteractionRank[];
	conclusion: string;
	tone: InteractionTone;
}

export interface InteractionSpec {
	id: string;
	type: 'formula' | 'cost' | 'decision' | 'constraint' | 'simulation';
	title: string;
	description: string;
	parameters: readonly InteractionParameter[];
	presets: readonly InteractionPreset[];
	evaluate: (values: Readonly<Record<string, number>>) => InteractionEvaluation;
}
