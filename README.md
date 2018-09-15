# Deploify

This module allows to create a temporary staging enviroment on Heroku for each of a repository pull request on Bitbucket, leveraging your Heroku account and Bitbucket webhooks.

### Setup:

#### 1. Setup the module to work with your Express server

```
const express = require('express');
const app = express();

require('deploify')(app, {
  bitbucket_user: "foo",
  bitbucket_email: "foo@bar.com",
  bitbucket_password: ""*******",
  bitbucket_key: "...",
  bitbucket_secret: "...",
  heroku_user: "foo@bar.com",
  heroku_password: "*******",
  domain_prefix: "fooqapreview-",
  branch_regex: /^qa-(.*)/
});
```

| Param | Type | Description |
| --- | --- | --- |
| app | <code>function</code> | Express instance |
| config | <code>Object</code> | Configuration object |
| config.webhook_endpoint | <code>string</code> | Endpoint for Bitbucket's webhook (e.g.: `/webhooks/bitbucket`) |
| config.bitbucket_user | <code>string</code> | Bitbucket username |
| config.bitbucket_password | <code>string</code> | Bitbucket password |
| config.bitbucket_email | <code>string</code> | Bitbucket email |
| config.bitbucket_key | <code>string</code> | Bitbucket OAuth key |
| config.bitbucket_secret | <code>string</code> | Bitbucket OAuth secret |
| config.heroku_user | <code>string</code> | Heroku username (email) |
| config.heroku_password | <code>string</code> | Heroku password |
| config.domain_prefix | <code>string</code> | Domain prefix for apps (e.g.: `qapreview-` will result in domains like `qapreview-435.herokuapp.com`) |
| config.branch_regex | <code>RegExp</code> | Regex to match in branch names (apps will be created only for matched branches) |

#### 2. Create the webhook on the Bitbucket repository of your choice

Go to your repository page, then follow `Settings` -> `Workflow` -> `Webhooks` -> `Add webhook`. Create a webhook choosing from the list of triggers the following events of the `Pull Request`: `Created`, `Updated`, `Merged` and `Declined`.
