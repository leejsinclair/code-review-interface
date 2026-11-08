# Run inside the container by `gitlab.sh bootstrap` via `gitlab-rails runner`.
# Idempotent: creates (or resets) a root personal access token with a known value
# so integration tests can authenticate without manual setup.

token_value = ENV.fetch('PRWB_GITLAB_TOKEN')
token_name = 'prwb-integration-tests'

user = User.find_by_username!('root')
token = user.personal_access_tokens.active.find_by(name: token_name) ||
        user.personal_access_tokens.new(name: token_name)
token.scopes = %w[api read_repository write_repository]
token.expires_at = 364.days.from_now.to_date
token.set_token(token_value)
token.save!

puts "token '#{token_name}' ready for #{user.username}, expires #{token.expires_at}"
