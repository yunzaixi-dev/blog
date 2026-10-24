/**
 * @param {{source: string, workingTreeChanges: string, imageID: string, pagesDirectory?: string}} report
 * @param {string} source
 * @param {string} changes
 */
export function assertReleaseCandidate(report, source, changes) {
  if (changes || report.workingTreeChanges || report.source !== source)
    throw new Error(
      'Release requires the verified clean source SHA; run verify:local on the final commit'
    )
  if (!/^sha256:[0-9a-f]{64}$/.test(report.imageID) || !report.pagesDirectory)
    throw new Error('Verification report lacks the tested image or Pages artifact')
}
