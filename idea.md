# The Idea 

Commonly when running multiple instances of Claude on a local host one encounters the following problem:

- Claude 1 has some information that Claude 2 doesn't.

For example:

- Claude 1 is working in a repo with r2 set up via rclone. 
- Claude 2 is being tasked with updating a unified rclone mount service. But Claude 2 insists "there are no rclone configs for r2 configured yet!"

The user/human realises that the rclone config must be in the repo that Claude 1 is working in.

Rather than fishing out the details in .env (etc), the human would like Claude 2 to tell Claude 1:

"Hey, so yeah. The bucket is A, and here's B and C (variables)".

While this could be achieved manually the idea here is to use a local MCP to support ad-hoc inter-agent connection on host. 

## Implementation 

Inspired by P2P systems, the agent creates an alias for each agent (say hopeful-spring).

Claude 1 and 2 need to meet in the middle somewhere. Virtually any port can be used to exchange the trivial amount of data they need to exchange. 

For simplicity, the  MCP exposes a single tool call: connect to Claude Junction.

The junction is an ephemeral P2P exchange system that hands out identifiers and supports direct information exchange and session initation and termination.

Expectation: Claude Junction will be routinely used to pass secrets from 1 to 2. Therefore, it should not store data persistently or unencrypted , even on host.