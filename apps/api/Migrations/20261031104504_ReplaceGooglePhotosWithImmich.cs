using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace HomeyDash.Api.Migrations
{
    /// <inheritdoc />
    public partial class ReplaceGooglePhotosWithImmich : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Photo sets picked from Google Photos have no Immich album to follow; their tiles show as missing.
            migrationBuilder.Sql("DELETE FROM PhotoSets;");

            migrationBuilder.DropTable(
                name: "GoogleAccounts");

            migrationBuilder.DropTable(
                name: "GoogleClients");

            migrationBuilder.RenameColumn(
                name: "PickedAt",
                table: "PhotoSets",
                newName: "SyncedAt");

            migrationBuilder.AddColumn<string>(
                name: "AlbumId",
                table: "PhotoSets",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "AlbumName",
                table: "PhotoSets",
                type: "TEXT",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "ImmichAccounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false),
                    Address = table.Column<string>(type: "TEXT", nullable: false),
                    ApiKey = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImmichAccounts", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ImmichAccounts");

            migrationBuilder.DropColumn(
                name: "AlbumId",
                table: "PhotoSets");

            migrationBuilder.DropColumn(
                name: "AlbumName",
                table: "PhotoSets");

            migrationBuilder.RenameColumn(
                name: "SyncedAt",
                table: "PhotoSets",
                newName: "PickedAt");

            migrationBuilder.CreateTable(
                name: "GoogleAccounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false),
                    Email = table.Column<string>(type: "TEXT", nullable: true),
                    RefreshToken = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleAccounts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "GoogleClients",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false),
                    ClientId = table.Column<string>(type: "TEXT", nullable: false),
                    ClientSecret = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleClients", x => x.Id);
                });
        }
    }
}
