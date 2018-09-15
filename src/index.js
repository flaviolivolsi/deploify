const _ = require("lodash");
const request = require("request");
const Heroku = require("heroku-client");
const Oauth2 = require("simple-oauth2");

/**
 * Index module
 * @module index
 */

/**
 * @param {Function}  app                           - Express instance
 * @param {Object}    config                        - Configuration object
 * @param {string}    config.webhook_endpoint       - Endpoint for Bitbucket's webhook (e.g.: `/webhooks/bitbucket`)
 * @param {string}    config.bitbucket_user         - Bitbucket username
 * @param {string}    config.bitbucket_password     - Bitbucket password
 * @param {string}    config.bitbucket_email        - Bitbucket email
 * @param {string}    config.bitbucket_key          - Bitbucket OAuth key
 * @param {string}    config.bitbucket_secret       - Bitbucket OAuth secret
 * @param {string}    config.heroku_user            - Heroku username (email)
 * @param {string}    config.heroku_password        - Heroku password
 * @param {string}    config.domain_prefix          - Domain prefix for apps (e.g.: `qapreview-` will result in domains like `qapreview-435.herokuapp.com`)
 * @param {RegExp}    config.branch_regex           - Regex to match in branch names (apps will be created only for matched branches)
 * @param {Object}    config.env_vars               - Environment variables to be attached to Heroku apps 
 */
module.exports = (app, config) => {
  const bitbucket_oauth2 = Oauth2.create({
    client: {
      id: config.bitbucket_key,
      secret: config.bitbucket_secret,
    },
    auth: {
      tokenHost: "https://bitbucket.org",
      tokenPath: "/site/oauth2/access_token",
      authorizePath: "/site/oauth2/authorize",
    },
  });

  const bitbucket_token_config = {
    username: config.bitbucket_email,
    password: config.bitbucket_password,
    grant_type: "password",
  };

  /**
   * Creates Bitbucket oauth token
   */
  const bitbucket_oauth = () => {
    return new Promise((resolve, reject) => {
      bitbucket_oauth2.ownerPassword.getToken(bitbucket_token_config, (error, result) => {
        if (error) {
          return reject(error);
        }

        return resolve(oauth2.accessToken.create(result));
      });
    });
  };

  /**
   * Creates Heroku oauth token
   */
  const heroku_oauth = () => {
    return new Promise((resolve, reject) => {
        const options = {
            method: "POST",
            url: "https://api.heroku.com/oauth/authorizations",
            headers: {
                "content-type"  : "application/json",
                "accept"        : "application/vnd.heroku+json; version=3",
                "authorization" : `Basic ${new Buffer(`${config.heroku_user}:${config.heroku_password}`).toString("base64")}`
            },
            json: true
        };

        request(options, (err, res) => {
            if (err) {
                return reject(err);
            }

            resolve(res.body);
        });
    });
};
  

  /**
   * Gets the ID of a pull request
   * 
   * @param {*} repository 
   * @param {*} branch 
   */
  const get_pull_request_id = (repository, branch) => {
    return new Promise((resolve, reject) => {
      Promise.resolve(bitbucket_oauth())
        .then((result) => {
          const options = {
            method: "GET",
            url: `https://api.bitbucket.org/2.0/repositories/${repository}/pullrequests`,
            qs: { q: `source.branch.name="${branch}" AND state = "OPEN"` },
            headers:
            {
              "cache-control": "no-cache",
              authorization: `Bearer ${result.token.access_token}`,
            },
          };

          request(options, (err, res) => {
            if (err) {
              return reject(err);
            }

            const pull_request_id = _.at(JSON.parse(res.body), "values[0].id")[0];

            return resolve(pull_request_id);
          });
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  /**
   * Checks whether the branch is going to be merged on a QA branch
   * 
   * @param {*} source 
   * @param {*} destination 
   */
  const is_mergeable_on_qa_branch = (source, destination) => {
    return !new RegExp(config.branch_regex).test(source) && new RegExp(config.branch_regex).test(destination);
  }

  /**
   * Checks whether the pull request is created or updated by checking if his state is OPEN or MERGED
   * and comparing source and destinations branches, e.g., if a branch is going to be merged in a QA
   * branch, the app should be updated
   * 
   * @param {*} pullrequest 
   * @param {*} source 
   * @param {*} destination 
   */
  const is_creatable_or_updatable = (pullrequest, source, destination) => {
    return pullrequest && (pullrequest.state === "OPEN" || (pullrequest.state === "MERGED" && is_mergeable_on_qa_branch(source, destination)));
  }

  /**
   * Creates the app if it doesn't exist, otherwise it updates it
   * 
   * @param {*} obj 
   */
  const create_or_update_app = obj => {
    const tarball = `https://${encodeURIComponent(config.bitbucket_user)}:${encodeURIComponent(config.bitbucket_password)}@bitbucket.org/${obj.repo_full_name}/get/${obj.deployable_branch}.tar.gz`;
    let heroku;
    let match;
    let app_url;

    return Promise.resolve(heroku_oauth())
      .then((result) => {
        heroku = new Heroku({ token: result.access_token.token });

        return heroku.get("/apps");
      })
      .then((apps) => {
        // -- Searching for already existing app
        match = _.find(apps, app => app.name === obj.app_name);

        // -- App not found, meaning the pull request is new and an app will be created
        if (!match) {
          return heroku.post("/apps", {
            body: {
              name: obj.app_name,
            },
          });
        }

        // -- App found, it will be updated
        return match;
      })
      .then((app) => {
        // -- If the app is new, then we set the URL in order to send the comment after the
        //    build and we set the config vars
        if (!match) {
          app_url = app.web_url;

          return heroku.patch(`/apps/${obj.app_name}/config-vars`, {
            body: config.env_vars
          });
        }

        return null;
      })
      .then(() => {
        return heroku.post(`/apps/${obj.app_name}/builds`, {
          body: {
            source_blob: {
              url: tarball,
            },
          },
        });
      })
      .then(() => {
        // -- If no `app_url` is set, then we skip the comment
        if (!app_url) {
          return null;
        }

        return new Promise((resolve, reject) => {
          const content = 
            `The pull request **${obj.pullrequest_title}** is being deployed to [${app_url}](${app_url}). ` +
            `Please hang on while the deployment is completed.`;

          request({
            method: "POST",
            url: `https://${encodeURIComponent(config.bitbucket_user)}:${encodeURIComponent(config.bitbucket_password)}` +
              "@api.bitbucket.org/1.0/repositories/" +
              `${obj.repo_full_name}/pullrequests/` +
              `${obj.pullrequest_id}/comments`,
            form: {
              content,
            },
          }, (err, res) => {
            if (err) {
              return reject(err);
            }

            return resolve(res);
          });
        });
      })
      .catch(err => {
        console.error(`Error occurred: ${err}`);
      });
  }

  /**
   * Bitbucket webhook
   * 
   * @param {*} req 
   * @param {*} res 
   */
  const webhook = (req, res) => {
    const domain_prefix = config.domain_prefix;
    const repo_full_name = req.body.pullrequest.source.repository.full_name;
    const branch_name = req.body.pullrequest.source.branch.name;
    const destination_branch_name = req.body.pullrequest.destination.branch.name;
    const pullrequest_title = req.body.pullrequest.title;
    let pullrequest_id = req.body.pullrequest.id;
    let app_name = domain_prefix + pullrequest_id;

    // -- Pull request created/updated event
    if (is_creatable_or_updatable(req.body.pullrequest, branch_name, destination_branch_name)) {
      let deployable_branch = branch_name;

      if (!new RegExp(config.branch_regex).test(branch_name) && req.body.pullrequest.state === "OPEN") {
        return res.sendStatus(200);
      }

      if (is_mergeable_on_qa_branch(branch_name, destination_branch_name)) {
        deployable_branch = destination_branch_name;

        // -- Updates PR info if the branch is merged on QA branch
        return get_pull_request_id(repo_full_name, destination_branch_name)
          .then((result) => {
            if (!result) {
              return null;
            }
            pullrequest_id = result;
            app_name = domain_prefix + pullrequest_id;

            return create_or_update_app({
              repo_full_name,
              deployable_branch,
              pullrequest_title,
              pullrequest_id,
              app_name,
            });
          })
          .then(() => res.sendStatus(200))
          .catch((error) => {
            return res.sendStatus(500);
          });
      }

      return create_or_update_app({
        repo_full_name,
        deployable_branch,
        pullrequest_title,
        pullrequest_id,
        app_name,
      })
        .then(() => res.sendStatus(200))
        .catch((error) => {
          return res.sendStatus(500);
        });
    }

    // -- Pull request declined event
    if (req.body.pullrequest && req.body.pullrequest.state !== "OPEN") {
      let heroku;

      Promise.resolve(heroku_oauth())
        .then((result) => {
          heroku = new Heroku({ token: result.access_token.token });

          return heroku.get("/apps");
        })
        .then((apps) => {
          // -- Searching for already existing app
          const match = _.find(apps, app => app.name === app_name);

          if (match) {
            return heroku.delete(`/apps/${app_name}`);
          }

          return null;
        })
        .then(() => res.sendStatus(200))
        .catch((error) => {
          res.sendStatus(500);
        });

      return null;
    }

    return res.sendStatus(400);
  };

  app.route(config.webhook_endpoint).get(webhook);
  app.route(config.webhook_endpoint).post(webhook);
};
