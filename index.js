import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import { Octokit } from '@octokit/rest';

// Configuration
const config = {
    GITHUB_TOKEN: 'YOUR_GITHUB_TOKEN',
    REPO_NAME: 'crypto-coins-catalog',
    CATEGORY: 'defi',
    OWNER: 'YOUR_GITHUB_USERNAME'
};

function translateChainId(chainId) {
    if(chainId == "0x1")
      return "ethereum"
    else if(chainId == "solana")
      return "solana"
    else if(chainId == "0x38")
      return "bsc"
    else if(chainId == "0xa4b1")
      return "arbitrum"
    else if(chainId == "0x89")
      return "polygon"
    else if(chainId == "0x2105")
      return "base"
    else
      return null;
  }

async function fetchCoinsFromMoralis() {
    try {
        const response = await axios.get('https://moralis-money-coins.aws-prod-money-2.moralis.io/coins/get-trending-coins');
        return response.data.coins;
    } catch (error) {
        console.error('Error fetching from Moralis:', error.message);
        return [];
    }
}

async function createMarkdownFile(coin) {
    console.log(coin);
    const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    const folderPath = path.join('trending', today, coin.uniqueName ? coin.uniqueName : coin.name);
    const fileName = `README.md`;
    const filePath = path.join(folderPath, fileName);

    const content = `---
title: ${coin.name}
symbol: ${coin.symbol}
categories: ${coin.categories.join(', ')}
contract_address: ${coin.contract_address}
updated_at: ${new Date().toISOString()}
---

# ${coin.name} (${coin.symbol})
The [${coin.name} token](https://moralis.com/chain/${translateChainId(coin.chainId)}/token/price/${coin.uniqueName}) is trading live on the ${translateChainId(coin.chainId)} blockchain.

## Links
- Price and chart: https://moralis.com/chain/${translateChainId(coin.chainId)}/token/price/${coin.uniqueName}

## Market Data
- Current Price: $${coin.price || 'N/A'}
- Market Cap: $${coin.market_cap || 'N/A'}
- 24h Volume: $${coin.volume24H || 'N/A'}
`;

    try {
        await fs.mkdir(folderPath, { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
        return filePath;
    } catch (error) {
        console.error(`Error creating file ${filePath}:`, error.message);
        throw error;
    }
}

async function pushToGithub(category) {
    const octokit = new Octokit({ auth: config.GITHUB_TOKEN });
    const basePath = path.join('content', category);

    try {
        // Check if repo exists, create if it doesn't
        try {
            await octokit.repos.get({
                owner: config.OWNER,
                repo: config.REPO_NAME,
            });
        } catch {
            await octokit.repos.createForAuthenticatedUser({
                name: config.REPO_NAME,
                private: false,
            });
        }

        // Get all files in the category directory
        const files = await fs.readdir(basePath);
        
        for (const file of files) {
            const filePath = path.join(basePath, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const contentEncoded = Buffer.from(content).toString('base64');

            try {
                // Try to get existing file
                const existingFile = await octokit.repos.getContent({
                    owner: config.OWNER,
                    repo: config.REPO_NAME,
                    path: filePath,
                });

                // Update existing file
                await octokit.repos.createOrUpdateFileContents({
                    owner: config.OWNER,
                    repo: config.REPO_NAME,
                    path: filePath,
                    message: `Update ${file} - ${new Date().toISOString()}`,
                    content: contentEncoded,
                    sha: existingFile.data.sha,
                });
            } catch (error) {
                if (error.status === 404) {
                    // Create new file if it doesn't exist
                    await octokit.repos.createOrUpdateFileContents({
                        owner: config.OWNER,
                        repo: config.REPO_NAME,
                        path: filePath,
                        message: `Add ${file} - ${new Date().toISOString()}`,
                        content: contentEncoded,
                    });
                } else {
                    throw error;
                }
            }
        }
    } catch (error) {
        console.error('Error pushing to GitHub:', error.message);
        throw error;
    }
}

async function generateMainReadme() {
    try {
        // Get all date folders
        const contentDir = path.join('trending');
        const dates = await fs.readdir(contentDir);
        
        // Sort dates in reverse chronological order
        dates.sort((a, b) => b.localeCompare(a));

        let readmeContent = `# Moralis Trending Catalog

This repository contains information about various cryptocurrency tokens that has been trending on Moralis, organized by date.

## Available Collections\n\n`;

        // Add links for each date
        for (const date of dates) {
            const dateDir = path.join(contentDir, date);
            const files = await fs.readdir(dateDir);
            
            readmeContent += `### ${date}\n\n`;
            
            // Sort files alphabetically
            files.sort((a, b) => a.localeCompare(b));
            
            // Add links to each token file
            for (const file of files) {
                const tokenName = path.basename(file, '.md');
                readmeContent += `- [${tokenName}](trending/${date}/${file})\n`;
            }
            readmeContent += '\n';
        }

        // Add footer
        readmeContent += `\n## Last Updated: ${new Date().toISOString()}`;

        // Write README.md to root directory
        await fs.writeFile('README.md', readmeContent, 'utf-8');
        
        // Push README to GitHub
        const octokit = new Octokit({ auth: config.GITHUB_TOKEN });
        const content = Buffer.from(readmeContent).toString('base64');

        try {
            const existingFile = await octokit.repos.getContent({
                owner: config.OWNER,
                repo: config.REPO_NAME,
                path: 'README.md',
            });

            await octokit.repos.createOrUpdateFileContents({
                owner: config.OWNER,
                repo: config.REPO_NAME,
                path: 'README.md',
                message: `Update README.md - ${new Date().toISOString()}`,
                content: content,
                sha: existingFile.data.sha,
            });
        } catch (error) {
            if (error.status === 404) {
                await octokit.repos.createOrUpdateFileContents({
                    owner: config.OWNER,
                    repo: config.REPO_NAME,
                    path: 'README.md',
                    message: `Add README.md - ${new Date().toISOString()}`,
                    content: content,
                });
            } else {
                throw error;
            }
        }

        console.log('README.md generated and pushed successfully!');
    } catch (error) {
        console.error('Error generating README:', error.message);
    }
}

async function main() {
    try {
        // Fetch coins from Moralis
        // const coins = await fetchCoinsFromMoralis(config.CATEGORY);
        
        // // Create markdown files for each coin
        // for (const coin of coins) {
        //     const filePath = await createMarkdownFile(coin, config.CATEGORY);
        //     console.log(`Created file: ${filePath}`);
        // }

        // // Push to GitHub
        // await pushToGithub(config.CATEGORY);
        
        // Generate and push README
        await generateMainReadme();
        
        console.log('All operations completed successfully!');
    } catch (error) {
        console.error('Error in main process:', error.message);
        console.error(error.stack);
    }
}

// Run the script
main();
