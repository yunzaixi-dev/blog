export const defaultPreviewPort = '45100'

/**
 * @param {string[]} args - raw argument list
 * @param {string} name - option flag name
 * @returns {string | null}
 */
export function readArg(args, name) {
  const withEquals = args.find((arg) => arg.startsWith(`${name}=`))

  if (withEquals) {
    return withEquals.slice(name.length + 1)
  }

  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1]
}

/**
 * @param {string[]} rawArgs - raw argument list
 * @param {NodeJS.ProcessEnv} [env] - environment variables
 * @returns {{ args: string[], port: string, skipBuild: boolean }}
 */
export function parsePreviewArgs(rawArgs, env = process.env) {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  const port = readArg(args, '--port') || env.PORT || defaultPreviewPort
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error('Invalid preview port')

  return {
    args,
    port,
    skipBuild: args.includes('--no-build'),
  }
}
