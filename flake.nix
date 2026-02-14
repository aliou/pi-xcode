{
  description = "pi-xcode dev shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        xcodeWrapper = pkgs.xcodeenv.composeXcodeWrapper { versions = [ ]; };
      in
      {
        devShells.default = pkgs.mkShellNoCC {
          packages = with pkgs; [
            nodejs_22
            pnpm_10
            xcodegen
          ];

          shellHook = ''
            export PATH="${xcodeWrapper}/bin:$PATH"
            export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
            unset CC LD

            echo "pi-xcode dev environment"
            echo "Node: $(node --version)"
            echo "pnpm: $(pnpm --version)"
          '';
        };
      }
    );
}
