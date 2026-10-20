using System;
using System.IO;

namespace Ryujinx.Common
{
    // Only member used by the linked Shader sources. No desktop Common/NuGets.
    internal static class EmbeddedResources
    {
        public static string ReadAllText(string filename)
        {
            string name = filename.Replace('/', '.');
            using Stream stream = typeof(EmbeddedResources).Assembly.GetManifestResourceStream(name)
                ?? throw new InvalidOperationException($"Missing embedded shader helper: {name}");
            using var reader = new StreamReader(stream);
            return reader.ReadToEnd();
        }
    }
}
