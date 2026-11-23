#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, readJsonl, requiredArg, writeJsonNew, writeJsonlNew } from './common.mjs';
import { compileSnapshot } from './snapshot-compiler.mjs';
import { freezeRetrieval } from './retrieval-store.mjs';
import { judgeBatch, loadJudgeConfig } from './query-semantic-judge.mjs';
import { buildReport } from './aggregation-report.mjs';
import { calibrate, makeCalibrationSet } from './scorer-calibration.mjs';

const args = parseArgs(process.argv.slice(2)); const command = args._[0];
try {
  let result;
  if (command === 'compile') {
    const output = requiredArg(args, 'out'); const validation = requiredArg(args, 'validation');
    if (fs.existsSync(output) || fs.existsSync(validation) || (args.trace && fs.existsSync(args.trace))) throw new Error('Snapshot, validation, and trace files must not already exist');
    const compiled = compileSnapshot(requiredArg(args, 'source'), { datasetVersion: args['dataset-version'], mappingVersion: args['mapping-version'], ledger: args.ledger });
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true, mode: 0o700 });
    writeJsonNew(output, compiled.snapshot); writeJsonNew(validation, compiled.report); if (args.trace) writeJsonlNew(args.trace, compiled.trace); result = compiled.report;
  } else if (command === 'freeze-retrieval') {
    const rows = freezeRetrieval({ snapshotPath: requiredArg(args, 'snapshot'), rawPath: requiredArg(args, 'raw'), manifestPath: args.manifest, outputDir: requiredArg(args, 'out'), experimentId: requiredArg(args, 'experiment'), k: Number(args.k || 12) });
    result = { records: rows.length, errors: rows.filter((r) => r.error).length };
  } else if (command === 'judge') {
    const ids = args.selection ? readJsonl(args.selection).map((r) => r.query_id) : null;
    result = await judgeBatch({ snapshotPath: requiredArg(args, 'snapshot'), retrievalPath: requiredArg(args, 'retrieval'), outputPath: requiredArg(args, 'out'), config: loadJudgeConfig(args.config), concurrency: Number(args.concurrency || 3), maxAttempts: Number(args.attempts || 3), queryIds: ids, resume: args.resume === true });
  } else if (command === 'report') {
    result = buildReport({ snapshotPath: requiredArg(args, 'snapshot'), retrievalDir: requiredArg(args, 'retrieval-dir'), semanticPath: args.semantic || null, sourceOrderAuditPath: args['source-order-audit'] || null, calibrationPath: args.calibration || null, outputDir: requiredArg(args, 'out') });
  } else if (command === 'calibration-set') {
    const records = makeCalibrationSet({ snapshotPath: requiredArg(args, 'snapshot'), retrievalPath: requiredArg(args, 'retrieval'), outputDir: requiredArg(args, 'out'), count: Number(args.count || 120), seed: args.seed });
    result = { samples: records.length };
  } else if (command === 'calibrate') {
    result = calibrate({ snapshotPath: requiredArg(args, 'snapshot'), retrievalPath: requiredArg(args, 'retrieval'), annotationPath: requiredArg(args, 'annotations'), semanticPath: requiredArg(args, 'semantic'), repeatPath: args.repeat || null, outputPath: requiredArg(args, 'out') });
  } else {
    throw new Error('Commands: compile, freeze-retrieval, judge, report, calibration-set, calibrate');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  console.error(`eval-v1: ${error.message}`); process.exitCode = 1;
}
